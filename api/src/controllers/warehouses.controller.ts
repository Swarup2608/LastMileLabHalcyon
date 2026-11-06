import type { Request, Response } from "express";
import type { WarehousesService } from "../services/warehouses.service.js";

export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  list = async (_req: Request, res: Response) => {
    res.json({ warehouses: await this.warehouses.list() });
  };
}
