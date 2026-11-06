import { Router } from "express";
import type { AuditController } from "../controllers/audit.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { listAuditSchema } from "../schemas/audit.schema.js";

// Mounted at /api/audit. Admin only: the audit trail of every sign-in and change.
export function auditRoutes(controller: AuditController) {
  const router = Router();
  router.use(requireRole("admin"));
  router.get("/", validate(listAuditSchema), controller.list);
  return router;
}
