import { Router } from "express";
import type { Pool } from "pg";

export interface HealthState {
  shuttingDown: boolean;
}

export function healthRoutes(db: Pool, state: HealthState) {
  const router = Router();

  // Liveness: the process is up and serving requests.
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Readiness: the server can handle traffic (dependencies reachable, not draining).
  router.get("/ready", async (_req, res) => {
    if (state.shuttingDown) {
      res.status(503).json({ status: "shutting_down" });
      return;
    }

    const checks: Record<string, "ok" | "error"> = { database: "ok" };
    try {
      await db.query("SELECT 1");
    } catch {
      checks.database = "error";
    }

    const ready = Object.values(checks).every((check) => check !== "error");
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
  });

  return router;
}
