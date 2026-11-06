import { Router } from "express";
import type { StaffController } from "../controllers/staff.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { createStaffSchema, getStaffSchema, staffDemoSchema, updateStaffSchema } from "../schemas/staff.schema.js";

// Mounted at /api/staff. Admin only.
export function staffRoutes(controller: StaffController) {
  const router = Router();
  router.use(requireRole("admin"));
  router.get("/", controller.list);
  router.post("/", validate(createStaffSchema), controller.create);
  router.get("/:id", validate(getStaffSchema), controller.get);
  router.patch("/:id", validate(updateStaffSchema), controller.update);
  router.patch("/:id/demo", validate(staffDemoSchema), controller.setDemo);
  return router;
}
