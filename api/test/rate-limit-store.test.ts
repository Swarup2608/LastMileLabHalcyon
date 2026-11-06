// Redis rate-limit store against a real Redis. Runs only when REDIS_TEST_URL points at a throwaway Redis, e.g.
//   redis-server --port 6390 --save '' --appendonly no
//   REDIS_TEST_URL=redis://localhost:6390 npm test
// Every key it writes is under a random prefix and deleted afterwards.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Redis } from "ioredis";
import { RedisRateLimitStore } from "../src/middleware/redis-rate-limit-store.js";
import { loginRateLimit } from "../src/middleware/rate-limit.js";

const url = process.env.REDIS_TEST_URL;

describe("redis rate-limit store", { skip: url ? false : "set REDIS_TEST_URL to run" }, () => {
  const prefix = `halcyon:test:${randomUUID()}:`;
  let redis: Redis;

  before(() => {
    redis = new Redis(url!, { maxRetriesPerRequest: 1 });
  });

  after(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  const store = () => {
    const s = new RedisRateLimitStore(redis, prefix);
    s.init({ windowMs: 60_000 } as never);
    return s;
  };

  test("increment counts hits and starts one window", async () => {
    const s = store();
    const first = await s.increment("1.2.3.4");
    const second = await s.increment("1.2.3.4");
    assert.equal(first.totalHits, 1);
    assert.equal(second.totalHits, 2);
    const ttl = await redis.pttl(`${prefix}1.2.3.4`);
    assert.ok(ttl > 55_000 && ttl <= 60_000, `ttl ${ttl}`);
    assert.ok(Math.abs(second.resetTime!.getTime() - first.resetTime!.getTime()) < 1_000);
  });

  test("decrement takes a hit back and leaves no empty counter", async () => {
    const s = store();
    await s.increment("5.6.7.8");
    await s.decrement("5.6.7.8");
    assert.equal(await redis.exists(`${prefix}5.6.7.8`), 0);
    await s.decrement("5.6.7.8");
    assert.equal(await redis.exists(`${prefix}5.6.7.8`), 0);
    assert.equal(await s.get("5.6.7.8"), undefined);
  });

  test("resetKey clears a client", async () => {
    const s = store();
    await s.increment("9.9.9.9");
    await s.resetKey("9.9.9.9");
    assert.equal(await s.get("9.9.9.9"), undefined);
  });

  test("the limiter blocks after 10 failures and two app instances share the count", async () => {
    const listen = async () => {
      const app = express();
      // One proxy hop, like Azure App Service, so x-forwarded-for picks the client IP.
      app.set("trust proxy", 1);
      app.post("/login", loginRateLimit(new RedisRateLimitStore(redis, `${prefix}app:`)), (_req, res) => {
        res.status(401).end();
      });
      const server = app.listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    };
    const a = await listen();
    const b = await listen();
    const hit = (base: string) => fetch(`${base}/login`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.1" } });

    try {
      for (let i = 0; i < 5; i++) assert.equal((await hit(a.base)).status, 401);
      for (let i = 0; i < 5; i++) assert.equal((await hit(b.base)).status, 401);
      assert.equal((await hit(a.base)).status, 429);
      assert.equal((await hit(b.base)).status, 429);
      // Another IP is unaffected.
      const other = await fetch(`${a.base}/login`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.2" } });
      assert.equal(other.status, 401);
    } finally {
      a.server.close();
      b.server.close();
    }
  });
});
