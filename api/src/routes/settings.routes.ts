import { Router } from "express";
import type { SettingsController } from "../controllers/settings.controller.js";
import { requireAuth, requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { deliveryRuleSchema } from "../schemas/settings.schema.js";

// Mounted at /api/settings. Any signed-in user reads them (both portals show expected delivery dates); admins change them.
export function settingsRoutes(controller: SettingsController) {
  const router = Router();
  router.use(requireAuth);
  router.get("/", controller.get);
  router.put("/delivery", requireRole("admin"), validate(deliveryRuleSchema), controller.setDelivery);
  return router;
}
