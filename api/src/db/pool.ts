import { Pool } from "pg";
import type { Config } from "../config/env.js";

export function createPool(config: Config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client dropping (e.g. Postgres restart) must not crash the process; the pool replaces it.
  pool.on("error", (err) => console.error("postgres pool error", err));
  return pool;
}
