import { Router } from "express";
import type { ProductsController } from "../controllers/products.controller.js";
import { requireAuth } from "../middleware/authorize.js";

// Mounted at /api/products. Staff read every product's stock, client users read their own client's.
export function productsRoutes(controller: ProductsController) {
  const router = Router();
  router.use(requireAuth);
  router.get("/", controller.list);
  return router;
}
