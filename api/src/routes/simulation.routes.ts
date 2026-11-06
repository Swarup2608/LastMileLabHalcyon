import { Router } from "express";
import type { SimulationController } from "../controllers/simulation.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { simulateCarrierSchema, simulateEmailSchema, simulateRebalanceSchema } from "../schemas/simulation.schema.js";

// Mounted at /api/simulation. Admins only, like the Simulation page: the web simulation asking the real agents about
// simulated orders. Not saved.
export function simulationRoutes(controller: SimulationController) {
  const router = Router();
  router.use(requireRole("admin"));
  router.get("/", controller.status);
  router.post("/carrier", validate(simulateCarrierSchema), controller.carrier);
  router.post("/rebalance", validate(simulateRebalanceSchema), controller.rebalanceProducts);
  router.post("/email", validate(simulateEmailSchema), controller.email);
  return router;
}
