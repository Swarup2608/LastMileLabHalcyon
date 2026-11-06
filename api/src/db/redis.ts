import { Redis } from "ioredis";

export function createRedis(url: string) {
  const redis = new Redis(url, {
    // Fail a command fast instead of retrying for long; the rate limiter lets the request through on a store error.
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  // A dropped connection (e.g. Upstash idle timeout) must not crash the process; ioredis reconnects on its own.
  redis.on("error", (err) => console.error("redis error", err.message));
  return redis;
}
