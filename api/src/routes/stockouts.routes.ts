import { Router } from "express";
import type { StockoutsController } from "../controllers/stockouts.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { listStockoutsSchema } from "../schemas/stockouts.schema.js";

// Mounted at /api/stockouts. Staff only: the log of stock-outs at the nearest warehouse, for Inventory.
export function stockoutsRoutes(controller: StockoutsController) {
  const router = Router();
  router.use(requireRole("admin", "contributor"));
  router.get("/", validate(listStockoutsSchema), controller.list);
  return router;
}
