import { Router } from "express";
import type { RebalanceController } from "../controllers/rebalance.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { applyRebalanceSchema, listTransfersSchema, suggestRebalanceSchema } from "../schemas/rebalance.schema.js";

// Mounted at /api/rebalance. Staff only: the allocation agent's suggested stock transfers for Inventory, applying the
// ones staff keep, and the transfers applied so far.
export function rebalanceRoutes(controller: RebalanceController) {
  const router = Router();
  router.use(requireRole("admin", "contributor"));
  router.post("/suggest", validate(suggestRebalanceSchema), controller.suggest);
  router.post("/apply", validate(applyRebalanceSchema), controller.apply);
  router.get("/transfers", validate(listTransfersSchema), controller.list);
  return router;
}
