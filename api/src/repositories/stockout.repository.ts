import type { Pool } from "pg";
import { withTransaction } from "../db/transaction.js";

export type Resolution = "rerouted" | "delayed" | "shipped_short";

// One order line the nearest warehouse couldn't cover, as the API decides it (StockoutService).
export interface StockoutEvent {
  productId: string;
  region: string;
  nearestWarehouseId: string;
  quantity: number;
  availableAtNearest: number;
  resolution: Resolution;
  shippedFromId: string | null;
  extraMiles: number | null;
  decidedAt: Date;
}

export interface StockoutRow {
  id: string;
  request_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  region: string;
  nearest_warehouse_id: string;
  quantity: number;
  available_at_nearest: number;
  resolution: Resolution;
  shipped_from_id: string | null;
  extra_miles: number | null;
  decided_at: Date;
}

export const toStockoutDto = (row: StockoutRow) => ({
  id: row.id,
  requestId: row.request_id,
  // As staff see it on Resolve.
  orderRef: `REQ-${row.request_id.slice(-6).toUpperCase()}`,
  productId: row.product_id,
  sku: row.sku,
  productName: row.product_name,
  region: row.region,
  nearestWarehouseId: row.nearest_warehouse_id,
  quantity: row.quantity,
  availableAtNearest: row.available_at_nearest,
  resolution: row.resolution,
  shippedFromId: row.shipped_from_id,
  extraMiles: row.extra_miles,
  decidedAt: row.decided_at,
});

// The stock-out log (db/init/11_stockout_events.sql).
export class StockoutRepository {
  constructor(private readonly db: Pool) {}

  // A request's events are always written together: its current routing decision replaces whatever it had before.
  async replaceForRequest(requestId: string, events: StockoutEvent[]) {
    await withTransaction(this.db, async (tx) => {
      await tx.query(`DELETE FROM stockout_events WHERE request_id = $1`, [requestId]);
      for (const e of events) {
        await tx.query(
          `INSERT INTO stockout_events (request_id, product_id, region, nearest_warehouse_id, quantity, available_at_nearest,
             resolution, shipped_from_id, extra_miles, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [requestId, e.productId, e.region, e.nearestWarehouseId, e.quantity, e.availableAtNearest, e.resolution, e.shippedFromId, e.extraMiles, e.decidedAt],
        );
      }
    });
  }

  // Requests that have at least one event.
  async requestIds() {
    const { rows } = await this.db.query<{ request_id: string }>(`SELECT DISTINCT request_id FROM stockout_events`);
    return new Set(rows.map((r) => r.request_id));
  }

  // Newest first.
  async listSince(since: Date) {
    const { rows } = await this.db.query<StockoutRow>(
      `SELECT s.id::text AS id, s.request_id, s.product_id, p.sku, p.product_name, s.region, s.nearest_warehouse_id, s.quantity,
              s.available_at_nearest, s.resolution, s.shipped_from_id, s.extra_miles, s.decided_at
       FROM stockout_events s JOIN products p ON p.product_id = s.product_id
       WHERE s.decided_at >= $1
       ORDER BY s.decided_at DESC, s.id DESC`,
      [since],
    );
    return rows;
  }
}
