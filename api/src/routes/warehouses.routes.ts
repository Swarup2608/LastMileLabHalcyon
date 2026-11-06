import { Router } from "express";
import type { WarehousesController } from "../controllers/warehouses.controller.js";
import { requireAuth } from "../middleware/authorize.js";

// Mounted at /api/warehouses. Any signed-in user: both portals show the warehouse network.
export function warehousesRoutes(controller: WarehousesController) {
  const router = Router();
  router.use(requireAuth);
  router.get("/", controller.list);
  return router;
}
