import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import type { Redis } from "ioredis";

// Adds a hit and starts the window on the first one, in one atomic step. Returns { hits, ms until the window ends }.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }`;

// Takes back a hit (skipSuccessfulRequests); never leaves a zero or negative counter behind.
const DECREMENT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local hits = redis.call('DECR', KEYS[1])
if hits <= 0 then redis.call('DEL', KEYS[1]) end
return hits`;

// express-rate-limit store backed by Redis (Upstash or any Redis 6+), so every API instance shares one counter per
// client and the counts survive restarts. Keys expire with the window; nothing needs cleaning up.
export class RedisRateLimitStore implements Store {
  localKeys = false;
  private windowMs = 60_000;

  constructor(
    private readonly redis: Redis,
    readonly prefix: string,
  ) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private key(key: string) {
    return this.prefix + key;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const [hits, ttl] = await Promise.all([this.redis.get(this.key(key)), this.redis.pttl(this.key(key))]);
    if (hits === null) return undefined;
    return { totalHits: Number(hits), resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const [hits, ttl] = (await this.redis.eval(INCREMENT, 1, this.key(key), this.windowMs)) as [number, number];
    return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key: string) {
    await this.redis.eval(DECREMENT, 1, this.key(key));
  }

  async resetKey(key: string) {
    await this.redis.del(this.key(key));
  }
}
