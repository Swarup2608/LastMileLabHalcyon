import type { Pool } from "pg";
import { withTransaction } from "../db/transaction.js";
import type { NewTransfer, StockTransferRepository } from "../repositories/stock-transfer.repository.js";

// How often in-transit transfers are checked for arrival.
export const TRANSFER_INTERVAL_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Thrown when a source no longer has the cartons; nothing in that apply was saved.
export class InsufficientStockError extends Error {
  constructor(readonly transfer: NewTransfer) {
    super(`${transfer.source} no longer has ${transfer.quantity} cartons of ${transfer.productId} available`);
  }
}

// Staff applying a rebalance from Inventory: every transfer is saved, and its cartons leave the source at once. They reach
// the destination delayDays later (STOCK_TRANSFER_DELAY_DAYS; 0 adds them in the same transaction), which is when
// Resolve's warehouse choice and auto-routing see them there.
export class StockTransferService {
  constructor(
    private readonly db: Pool,
    private readonly transfers: StockTransferRepository,
    readonly delayDays: number,
  ) {}

  // All or nothing: if any source is short, nothing is applied.
  async apply(items: NewTransfer[], by: string, now = new Date()) {
    const arrivesAt = new Date(now.getTime() + this.delayDays * DAY_MS);
    const immediate = this.delayDays === 0;
    const ids = await withTransaction(this.db, async (tx) => {
      // Every source is checked for its total before anything moves, so a short one leaves all stock as it was. The
      // conditional take below still guards against another apply in between.
      const totals = new Map<string, { t: NewTransfer; quantity: number }>();
      for (const t of items) {
        const key = `${t.productId}\u0000${t.source}`;
        totals.set(key, { t, quantity: (totals.get(key)?.quantity ?? 0) + t.quantity });
      }
      for (const { t, quantity } of totals.values()) {
        if ((await this.transfers.available(tx, t.productId, t.source)) < quantity) throw new InsufficientStockError({ ...t, quantity });
      }
      const created: string[] = [];
      for (const t of items) {
        if (!(await this.transfers.takeFromSource(tx, t))) throw new InsufficientStockError(t);
        if (immediate) await this.transfers.addToDestination(tx, t.productId, t.destination, t.quantity);
        created.push(await this.transfers.insert(tx, t, by, immediate ? now : arrivesAt, immediate));
      }
      return created;
    });
    return this.transfers.byIds(ids);
  }

  // Adds every transfer that has arrived to its destination; returns how many.
  async completeDue(now = new Date()) {
    let done = 0;
    for (const t of await this.transfers.due(now)) {
      const landed = await withTransaction(this.db, async (tx) => {
        if (!(await this.transfers.markCompleted(tx, t.id))) return false;
        await this.transfers.addToDestination(tx, t.product_id, t.destination_id, t.quantity);
        return true;
      });
      if (landed) done++;
    }
    return done;
  }

  // Runs now and then every intervalMs; returns a stop function. Failures are logged and retried next time.
  schedule(intervalMs = TRANSFER_INTERVAL_MS) {
    const tick = () =>
      this.completeDue().then(
        (n) => n && console.log(`stock transfers: ${n} arrived`),
        (err) => console.error("stock transfers failed", err),
      );
    void tick();
    const timer = setInterval(tick, intervalMs);
    // Never keeps the process alive on its own.
    timer.unref();
    return () => clearInterval(timer);
  }
}
