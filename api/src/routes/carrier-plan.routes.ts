import { Router } from "express";
import type { CarrierPlanController } from "../controllers/carrier-plan.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { carrierAssignSchema, carrierChoiceSchema } from "../schemas/carrier-plan.schema.js";

// Mounted at /api/carrier-plan. Staff only: today's carrier recommendations for the same-day orders.
export function carrierPlanRoutes(controller: CarrierPlanController) {
  const router = Router();
  router.use(requireRole("admin", "contributor"));
  router.get("/", controller.get);
  router.post("/run", controller.run);
  router.put("/carrier", validate(carrierChoiceSchema), controller.choose);
  router.post("/assign", validate(carrierAssignSchema), controller.assign);
  return router;
}
