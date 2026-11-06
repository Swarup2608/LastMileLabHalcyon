import { Router, type RequestHandler } from "express";
import type { AuthController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { loginSchema, updateAccountSchema } from "../schemas/auth.schema.js";

// Mounted at /api/auth/client and /api/auth/staff (admins and contributors share the staff realm).
export function authRoutes(controller: AuthController, loginLimiter: RequestHandler[]) {
  const router = Router();
  router.post("/login", loginLimiter, validate(loginSchema), controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);
  router.post("/logout-all", requireAuth, controller.logoutAll);
  router.get("/me", requireAuth, controller.me);
  // Shares the login limiter: it checks a password too, so it mustn't be a way around the brute-force limit.
  router.patch("/me", requireAuth, loginLimiter, validate(updateAccountSchema), controller.updateAccount);
  return router;
}
