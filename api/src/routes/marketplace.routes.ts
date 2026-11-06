import { Router, type RequestHandler } from "express";
import type { MarketplaceController } from "../controllers/marketplace.controller.js";
import { validate } from "../middleware/validate.js";
import { listMarketplaceSchema, marketplaceOrderSchema } from "../schemas/marketplace.schema.js";

// Mounted at /api/marketplace. Open to everyone, signed in or not. The limiter sits after validation, so a form typo
// (400) doesn't use up a visitor's attempts.
export function marketplaceRoutes(controller: MarketplaceController, signupLimiter: RequestHandler) {
  const router = Router();
  router.get("/products", validate(listMarketplaceSchema), controller.list);
  router.post("/orders", validate(marketplaceOrderSchema), signupLimiter, controller.placeOrder);
  return router;
}
