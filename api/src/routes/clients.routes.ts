import { Router } from "express";
import type { ClientsController } from "../controllers/clients.controller.js";
import { requireAuth, requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import {
  clientUserDemoSchema,
  createClientUserSchema,
  getClientSchema,
  listClientsSchema,
  signupClientSchema,
  updateClientUserSchema,
} from "../schemas/clients.schema.js";

// Mounted at /api/clients. Staff read every client, client users read their own; admins sign up new clients and
// manage client logins.
export function clientsRoutes(controller: ClientsController) {
  const router = Router();
  router.use(requireAuth);
  router.get("/", requireRole("admin", "contributor"), validate(listClientsSchema), controller.list);
  router.post("/", requireRole("admin"), validate(signupClientSchema), controller.signup);
  router.get("/:clientId", validate(getClientSchema), controller.get);
  router.get("/:clientId/users", requireRole("admin"), validate(getClientSchema), controller.listUsers);
  router.post("/:clientId/users", requireRole("admin"), validate(createClientUserSchema), controller.createUser);
  router.patch("/:clientId/users/:userId", requireRole("admin"), validate(updateClientUserSchema), controller.updateUser);
  router.patch(
    "/:clientId/users/:userId/demo",
    requireRole("admin"),
    validate(clientUserDemoSchema),
    controller.setUserDemo,
  );
  return router;
}
