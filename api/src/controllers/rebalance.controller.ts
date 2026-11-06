import type { Request, Response } from "express";
import { toTransferDto, type StockTransferRepository } from "../repositories/stock-transfer.repository.js";
import type { WarehouseRepository } from "../repositories/warehouse.repository.js";
import type { ApplyRebalanceBody, ListTransfersQuery, SuggestRebalanceBody } from "../schemas/rebalance.schema.js";
import type { AuditService } from "../services/audit.service.js";
import type { RebalanceService } from "../services/rebalance.service.js";
import { InsufficientStockError, type StockTransferService } from "../services/stock-transfer.service.js";
import { HttpError } from "../utils/http-error.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class RebalanceController {
  constructor(
    private readonly service: RebalanceService,
    private readonly transfers: StockTransferService,
    private readonly transferRows: StockTransferRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly audit: AuditService,
  ) {}

  // The allocation agent's suggested transfers for some products, or all of them. Not saved: staff review and edit it,
  // then apply what they want.
  suggest = async (req: Request, res: Response) => {
    if (!this.service.enabled) throw new HttpError(503, "Allocation agent is not configured");
    const { productIds } = req.body as SuggestRebalanceBody;
    const result = await this.service.suggest(productIds);
    if (!result.input.products.length) throw new HttpError(404, "None of those products is in the catalogue");
    await this.audit.record(req, {
      action: "rebalance.suggest",
      targetType: "products",
      targetId: productIds?.length === 1 ? productIds[0] : "all",
      details: { products: result.input.products.length, transferUnits: result.plan.summary.totalTransferUnits },
    });
    res.json({ ...result, transferDelayDays: this.transfers.delayDays });
  };

  // Saves the transfers staff applied. Their cartons leave each source now and reach the destination after
  // STOCK_TRANSFER_DELAY_DAYS (at once when 0). All or nothing: a source that's short refuses the lot.
  apply = async (req: Request, res: Response) => {
    const { transfers } = req.body as ApplyRebalanceBody;
    const known = new Set((await this.warehouses.list()).map((w) => w.warehouse_id));
    const unknown = transfers.find((t) => !known.has(t.source) || !known.has(t.destination));
    if (unknown) throw new HttpError(400, `Unknown warehouse in ${unknown.source} → ${unknown.destination}`);
    let rows;
    try {
      rows = await this.transfers.apply(
        transfers.map((t) => ({ ...t, reason: t.reason || null })),
        req.auth!.sub,
      );
    } catch (err) {
      if (err instanceof InsufficientStockError) throw new HttpError(409, `${err.message}; nothing was applied`);
      throw err;
    }
    await this.audit.record(req, {
      action: "rebalance.apply",
      targetType: "products",
      targetId: [...new Set(transfers.map((t) => t.productId))].join(",").slice(0, 200),
      details: {
        transfers: rows.length,
        units: transfers.reduce((s, t) => s + t.quantity, 0),
        edited: transfers.filter((t) => t.origin === "edited").length,
        delayDays: this.transfers.delayDays,
        ids: rows.map((r) => r.id),
      },
    });
    res.status(201).json({ delayDays: this.transfers.delayDays, transfers: rows.map(toTransferDto) });
  };

  // Transfers applied in the last `days` days, and any still in transit.
  list = async (req: Request, res: Response) => {
    const { days } = req.query as unknown as ListTransfersQuery;
    const rows = await this.transferRows.listSince(new Date(Date.now() - days * DAY_MS));
    res.json({ days, delayDays: this.transfers.delayDays, transfers: rows.map(toTransferDto) });
  };
}
