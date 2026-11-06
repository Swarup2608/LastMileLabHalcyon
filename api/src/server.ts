import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createContainer } from "./container.js";
import { createPool } from "./db/pool.js";
import { createRedis } from "./db/redis.js";
import type { HealthState } from "./routes/health.routes.js";

// Last line of defence: an error nothing else caught (a dropped database or Redis connection, a failed background
// job) is logged and the server keeps serving; /ready reports a dead database as 503.
process.on("unhandledRejection", (reason) => console.error("unhandled rejection (server keeps running)", reason));
process.on("uncaughtException", (err) => console.error("uncaught exception (server keeps running)", err));

const config = loadConfig();
const db = createPool(config);
const redis = config.redisUrl ? createRedis(config.redisUrl) : undefined;
const container = createContainer(config, db, redis);
console.log(`login rate limiter: ${redis ? "redis" : "in memory"}`);
const state: HealthState = { shuttingDown: false };

// The API no longer creates an admin on start (SEC-05); `npm run admin:create` does it once.
if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) {
  console.warn("ADMIN_EMAIL / ADMIN_PASSWORD are no longer used and can be removed; create admins with npm run admin:create");
}

export const app = createApp(container, state);
const stopRetention = container.services.retention.schedule();
const { emailAgent } = container.services;
// After each poll, every email not yet read by the agent goes to it (including ones whose last attempt failed).
const stopEmailPoller = container.services.emailPoller?.schedule(
  config.emailPoller!.intervalSeconds * 1000,
  emailAgent &&
    (() =>
      emailAgent.analyzePending().then(({ analyzed, failed }) => {
        if (analyzed || failed) console.log(`email agent: analyzed ${analyzed}, failed ${failed}`);
      })),
);
console.log(`email poller: ${stopEmailPoller ? `every ${config.emailPoller!.intervalSeconds}s` : "off (GOOGLE_* not set)"}`);
console.log(`email agent: ${emailAgent ? config.foundry!.agentName : "off (FOUNDRY_* not set)"}`);
// Every minute: this month's carrier figures (refreshed on the 1st), and today's carrier plan once the cutoff passes.
const stopCarrierPlan = container.services.carrierPlan.schedule();
console.log(`carrier agent: ${config.carrierAgent ? config.carrierAgent.agentName : "off (FOUNDRY_CARRIER_AGENT_NAME not set)"}`);
// Every minute: in-transit stock transfers that have arrived are added to their destination.
const stopTransfers = container.services.stockTransfers.schedule();
console.log(`stock transfers: ${config.stockTransferDelayDays ? `arrive after ${config.stockTransferDelayDays} day(s)` : "immediate"}`);
console.log(`allocation agent: ${config.allocationAgent ? config.allocationAgent.agentName : "off (FOUNDRY_ALLOCATION_IQ_AGENT_NAME not set)"}`);

const server = app.listen(config.port, () => {
  console.log(`halcyon-api listening on http://localhost:${config.port}`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  state.shuttingDown = true;
  stopRetention();
  stopEmailPoller?.();
  stopCarrierPlan();
  stopTransfers();
  server.close(async () => {
    await db.end();
    await redis?.quit().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
