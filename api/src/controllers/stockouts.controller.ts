import type { Request, Response } from "express";
import { toStockoutDto } from "../repositories/stockout.repository.js";
import type { ListStockoutsQuery } from "../schemas/stockouts.schema.js";
import type { StockoutService } from "../services/stockout.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class StockoutsController {
  constructor(private readonly stockouts: StockoutService) {}

  // Order lines the nearest warehouse couldn't cover over the last `days` days, newest first.
  list = async (req: Request, res: Response) => {
    const { days } = req.query as unknown as ListStockoutsQuery;
    const rows = await this.stockouts.listSince(new Date(Date.now() - days * DAY_MS));
    res.json({ days, stockouts: rows.map(toStockoutDto) });
  };
}
