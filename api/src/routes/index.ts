import { Router } from "express";
import type { Container } from "../container.js";
import { accountRateLimit, loginRateLimit, signupRateLimit } from "../middleware/rate-limit.js";
import { auditRoutes } from "./audit.routes.js";
import { authRoutes } from "./auth.routes.js";
import { carrierPlanRoutes } from "./carrier-plan.routes.js";
import { clientsRoutes } from "./clients.routes.js";
import { emailsRoutes, orderRequestsRoutes } from "./emails.routes.js";
import { marketplaceRoutes } from "./marketplace.routes.js";
import { productsRoutes } from "./products.routes.js";
import { rebalanceRoutes } from "./rebalance.routes.js";
import { simulationRoutes } from "./simulation.routes.js";
import { settingsRoutes } from "./settings.routes.js";
import { staffRoutes } from "./staff.routes.js";
import { stockoutsRoutes } from "./stockouts.routes.js";
import { warehousesRoutes } from "./warehouses.routes.js";

// Everything under /api.
export function apiRoutes({ controllers, rateLimitStores }: Container) {
  const router = Router();
  // Per IP and per account, shared by both realms, so switching login endpoints doesn't reset either count.
  const loginLimiter = [loginRateLimit(rateLimitStores?.ip), accountRateLimit(rateLimitStores?.account)];

  router.get("/auth/demo-accounts", controllers.demoAccounts.list);
  router.use("/auth/client", authRoutes(controllers.clientAuth, loginLimiter));
  router.use("/auth/staff", authRoutes(controllers.staffAuth, loginLimiter));
  router.use("/staff", staffRoutes(controllers.staff));
  router.use("/clients", clientsRoutes(controllers.clients));
  router.use("/warehouses", warehousesRoutes(controllers.warehouses));
  router.use("/products", productsRoutes(controllers.products));
  router.use("/marketplace", marketplaceRoutes(controllers.marketplace, signupRateLimit(rateLimitStores?.signup)));
  router.use("/audit", auditRoutes(controllers.audit));
  router.use("/emails", emailsRoutes(controllers.emails));
  router.use("/order-requests", orderRequestsRoutes(controllers.emails));
  router.use("/settings", settingsRoutes(controllers.settings));
  router.use("/carrier-plan", carrierPlanRoutes(controllers.carrierPlan));
  router.use("/rebalance", rebalanceRoutes(controllers.rebalance));
  router.use("/simulation", simulationRoutes(controllers.simulation));
  router.use("/stockouts", stockoutsRoutes(controllers.stockouts));
  return router;
}
