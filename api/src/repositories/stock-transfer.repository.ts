import type { Pool, PoolClient } from "pg";
import type { Queryable } from "../db/transaction.js";

export interface NewTransfer {
  productId: string;
  source: string;
  destination: string;
  quantity: number;
  origin: "suggested" | "edited";
  reason: string | null;
}

export interface TransferRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  source_id: string;
  destination_id: string;
  quantity: number;
  status: "in_transit" | "completed";
  origin: "suggested" | "edited";
  reason: string | null;
  created_by: string | null;
  created_at: Date;
  arrives_at: Date;
  completed_at: Date | null;
}

export const toTransferDto = (row: TransferRow) => ({
  id: row.id,
  productId: row.product_id,
  sku: row.sku,
  productName: row.product_name,
  source: row.source_id,
  destination: row.destination_id,
  quantity: row.quantity,
  status: row.status,
  origin: row.origin,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
  arrivesAt: row.arrives_at,
  completedAt: row.completed_at,
});

const SELECT = `SELECT t.id::text AS id, t.product_id, p.sku, p.product_name, t.source_id, t.destination_id, t.quantity, t.status,
    t.origin, t.reason, t.created_by, t.created_at, t.arrives_at, t.completed_at
  FROM stock_transfers t JOIN products p ON p.product_id = t.product_id`;

// Stock transfers (db/init/12_stock_transfers.sql) and the warehouse_products changes they make.
export class StockTransferRepository {
  constructor(private readonly db: Pool) {}

  // Takes the cartons out of the source, only if it still has that many available (on hand less reserved). false: it
  // doesn't, and nothing changed.
  async takeFromSource(tx: PoolClient, t: Pick<NewTransfer, "productId" | "source" | "quantity">) {
    const { rowCount } = await tx.query(
      `UPDATE warehouse_products SET quantity_on_hand = quantity_on_hand - $3::int, updated_at = now()
       WHERE warehouse_id = $1 AND product_id = $2 AND quantity_on_hand - quantity_reserved >= $3::int`,
      [t.source, t.productId, t.quantity],
    );
    return (rowCount ?? 0) > 0;
  }

  // Cartons of a product available (on hand less reserved) at a warehouse; 0 where it isn't stocked.
  async available(tx: Queryable, productId: string, warehouseId: string) {
    const { rows } = await tx.query<{ available: number }>(
      `SELECT quantity_on_hand - quantity_reserved AS available FROM warehouse_products WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId],
    );
    return rows[0] ? Number(rows[0].available) : 0;
  }

  // Adds cartons at a warehouse, starting a stock row there (reorder point 0) when it didn't carry the product.
  async addToDestination(tx: Queryable, productId: string, destination: string, quantity: number) {
    await tx.query(
      `INSERT INTO warehouse_products (warehouse_id, product_id, quantity_on_hand, quantity_reserved, reorder_point)
       VALUES ($1, $2, $3, 0, 0)
       ON CONFLICT (warehouse_id, product_id)
       DO UPDATE SET quantity_on_hand = warehouse_products.quantity_on_hand + EXCLUDED.quantity_on_hand, updated_at = now()`,
      [destination, productId, quantity],
    );
  }

  async insert(tx: PoolClient, t: NewTransfer, by: string, arrivesAt: Date, completed: boolean) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO stock_transfers (product_id, source_id, destination_id, quantity, origin, reason, created_by, arrives_at,
         status, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text AS id`,
      [t.productId, t.source, t.destination, t.quantity, t.origin, t.reason, by, arrivesAt, completed ? "completed" : "in_transit", completed ? arrivesAt : null],
    );
    return rows[0].id;
  }

  // Marks one due transfer completed; false when it isn't in transit any more (another instance got there first).
  async markCompleted(tx: PoolClient, id: string) {
    const { rowCount } = await tx.query(
      `UPDATE stock_transfers SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'in_transit'`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async due(now: Date) {
    const { rows } = await this.db.query<TransferRow>(`${SELECT} WHERE t.status = 'in_transit' AND t.arrives_at <= $1 ORDER BY t.arrives_at`, [now]);
    return rows;
  }

  async inTransit() {
    const { rows } = await this.db.query<TransferRow>(`${SELECT} WHERE t.status = 'in_transit' ORDER BY t.arrives_at`);
    return rows;
  }

  // Newest first: every transfer applied since `since`, plus any still in transit.
  async listSince(since: Date) {
    const { rows } = await this.db.query<TransferRow>(
      `${SELECT} WHERE t.created_at >= $1 OR t.status = 'in_transit' ORDER BY t.created_at DESC, t.id DESC`,
      [since],
    );
    return rows;
  }

  async byIds(ids: string[]) {
    const { rows } = await this.db.query<TransferRow>(`${SELECT} WHERE t.id::text = ANY($1::text[]) ORDER BY t.id`, [ids]);
    return rows;
  }
}
