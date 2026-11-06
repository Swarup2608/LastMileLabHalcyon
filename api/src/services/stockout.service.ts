import { clientOf, toEmailDto, type EmailRepository } from "../repositories/email.repository.js";
import { toProductDtos, type ProductRepository } from "../repositories/product.repository.js";
import type { StockoutEvent, StockoutRepository } from "../repositories/stockout.repository.js";
import type { SettingsRepository } from "../repositories/settings.repository.js";
import { toWarehouseDto, type WarehouseRepository } from "../repositories/warehouse.repository.js";
import { replyLines } from "../utils/reply-lines.js";
import { addressOf } from "../utils/request-address.js";
import type { Region } from "../utils/regions.js";

type Warehouse = ReturnType<typeof toWarehouseDto>;
type Context = Awaited<ReturnType<StockoutService["context"]>>;
type EmailRow = NonNullable<Awaited<ReturnType<EmailRepository["get"]>>>;

export interface WarehouseDemand {
  routed: number;
  missed: number;
  sentForOthers: number;
}

// Orders a warehouse should have served: what was routed there, less what it shipped only because the nearest
// warehouse was short, plus what it was short of as the nearest.
export const ordersOf = (d: WarehouseDemand) => Math.max(0, d.routed - d.sentForOthers + d.missed);

export interface DecisionLine {
  productId: string;
  quantity: number;
}

// Where staff (or auto-routing) sent a request, and any out-of-stock flag with a new date; lines are the matched
// products the web app saved with the decision.
export interface Decision {
  routed?: { warehouseIds?: string[]; at?: string; lines?: DecisionLine[] };
  stockFlag?: { warehouseId?: string; at?: string; lines?: DecisionLine[] };
}

// What the decision is judged on: the routing or flag time, so a save that didn't change it changes nothing.
export const decisionKey = (edits: unknown) => {
  const d = (edits ?? {}) as Decision;
  return JSON.stringify([d.routed?.warehouseIds ?? null, d.routed?.at ?? null, d.stockFlag?.warehouseId ?? null, d.stockFlag?.at ?? null]);
};

// Most cartons one line may claim: the lines come from the browser with the decision, so one bad save mustn't swamp the
// log or the rebalance demand.
export const MAX_LINE_QUANTITY = 10_000;

const validLines = (lines: unknown): DecisionLine[] =>
  Array.isArray(lines)
    ? lines
        .slice(0, 100)
        .filter(
          (l): l is DecisionLine =>
            !!l && typeof l.productId === "string" && Number.isInteger(l.quantity) && l.quantity > 0 && l.quantity <= MAX_LINE_QUANTITY,
        )
    : [];

// The order lines a stock-out is judged on, by request. available(productId, warehouseId) is cartons available now.
// A line is a stock-out at the nearest warehouse (fewest miles to the delivery region) when it has fewer than asked:
//   routed elsewhere → rerouted, with the extra miles; routed there anyway → shipped_short;
//   not routed, but flagged out of stock at the nearest with a new date → delayed.
// Not decided yet (neither routed nor flagged): nothing, it's still waiting to be routed.
export function eventsFor({
  region,
  lines,
  decision,
  warehouses,
  available,
}: {
  region: Region | null;
  lines: DecisionLine[];
  decision: Decision;
  warehouses: Warehouse[];
  available: (productId: string, warehouseId: string) => number;
}): StockoutEvent[] {
  if (!region) return [];
  const ranked = warehouses
    .filter((w) => w.milesToRegion[region] !== null)
    .sort((a, b) => a.milesToRegion[region]! - b.milesToRegion[region]!);
  const nearest = ranked[0];
  if (!nearest) return [];
  const milesOf = (id: string) => warehouses.find((w) => w.warehouseId === id)?.milesToRegion[region] ?? null;

  const shippedFrom = decision.routed?.warehouseIds?.[0];
  const flag = decision.stockFlag?.warehouseId === nearest.warehouseId ? decision.stockFlag : undefined;
  const at = shippedFrom ? decision.routed?.at : flag?.at;
  if (!at || (!shippedFrom && !flag)) return [];
  const decidedAt = new Date(at);
  if (Number.isNaN(decidedAt.getTime())) return [];
  const flagged = flag && !shippedFrom ? new Set(validLines(flag.lines).map((l) => l.productId)) : null;

  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);

  const events: StockoutEvent[] = [];
  for (const [productId, quantity] of merged) {
    const have = Math.max(0, available(productId, nearest.warehouseId));
    if (have >= quantity) continue;
    // A flag lists the lines it's about; without that list every short line counts.
    if (flagged && flagged.size && !flagged.has(productId)) continue;
    const base = { productId, region, nearestWarehouseId: nearest.warehouseId, quantity, availableAtNearest: have, decidedAt };
    if (!shippedFrom) {
      events.push({ ...base, resolution: "delayed", shippedFromId: null, extraMiles: null });
    } else if (shippedFrom === nearest.warehouseId) {
      events.push({ ...base, resolution: "shipped_short", shippedFromId: shippedFrom, extraMiles: 0 });
    } else {
      const miles = milesOf(shippedFrom);
      events.push({
        ...base,
        resolution: "rerouted",
        shippedFromId: shippedFrom,
        extraMiles: miles === null ? null : miles - nearest.milesToRegion[region]!,
      });
    }
  }
  return events;
}

// Logs stock-outs at the nearest warehouse whenever a request's routing or out-of-stock flag changes
// (db/init/11_stockout_events.sql). Inventory lists them and the allocation agent's rebalance input counts them.
export class StockoutService {
  constructor(
    private readonly stockouts: StockoutRepository,
    private readonly emails: EmailRepository,
    private readonly products: ProductRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly settings: SettingsRepository,
  ) {}

  // Catalogue, stock, warehouses and the delivery rule, loaded once per batch of requests.
  private async context() {
    const [productRows, warehouseRows, rule, logins] = await Promise.all([
      this.products.listWithStock(null),
      this.warehouses.list(),
      this.settings.deliveryRule(),
      this.emails.clientLogins(),
    ]);
    const products = toProductDtos(productRows);
    return {
      products,
      catalogue: products.map((p) => ({ ...p, stock: p.stock.reduce((s, x) => s + x.available, 0) })),
      warehouses: warehouseRows.map(toWarehouseDto),
      rule,
      logins,
    };
  }

  // The request's matched lines, its delivery region and its routing decision.
  private read(row: EmailRow, ctx: Context) {
    const dto = toEmailDto(row, ctx.logins, ctx.rule);
    const decision = (dto.edits ?? {}) as Decision & { lines?: Record<string, { productId?: string | null; quantity?: number | null; declined?: boolean }> };
    const known = new Set(ctx.products.map((p) => p.productId));
    // The lines the web app saved with the decision; else the request's lines read the way Resolve reads them.
    const saved = validLines(decision.routed?.lines ?? decision.stockFlag?.lines);
    const lines = (
      saved.length
        ? saved
        : replyLines((dto.aiResult as { output?: unknown } | null)?.output, decision.lines, ctx.catalogue, clientOf(row, ctx.logins))
    ).filter((l) => known.has(l.productId));
    return { lines, decision, region: addressOf(dto).region };
  }

  private judge(row: EmailRow, ctx: Context) {
    return eventsFor({
      ...this.read(row, ctx),
      warehouses: ctx.warehouses,
      available: (productId, warehouseId) =>
        ctx.products.find((p) => p.productId === productId)?.stock.find((s) => s.warehouseId === warehouseId)?.available ?? 0,
    });
  }

  // Re-judges one request from what's saved now; returns the events written.
  async recordFor(requestId: string) {
    const [row, ctx] = await Promise.all([this.emails.get(requestId), this.context()]);
    if (!row) return [];
    const events = this.judge(row, ctx);
    await this.stockouts.replaceForRequest(requestId, events);
    return events;
  }

  // Judges requests routed or flagged since `since` before the log existed (no lines saved with the decision, no events).
  // Requests that already have events keep them: they were judged on the stock when they were decided.
  async backfill(since: Date) {
    const [rows, logged, ctx] = await Promise.all([this.emails.listSince(since), this.stockouts.requestIds(), this.context()]);
    let recorded = 0;
    for (const row of rows) {
      const d = (row.edits ?? {}) as Decision;
      // Decisions saved with their lines were judged when they were saved.
      if (logged.has(row.message_id) || (!d.routed && !d.stockFlag) || d.routed?.lines || d.stockFlag?.lines) continue;
      const events = this.judge(row, ctx);
      if (!events.length) continue;
      await this.stockouts.replaceForRequest(row.message_id, events);
      recorded += events.length;
    }
    return recorded;
  }

  // Stock-outs logged since `since`, newest first, after judging any decided request not judged yet.
  async listSince(since: Date) {
    await this.backfill(since);
    return this.stockouts.listSince(since);
  }

  // Demand per product per warehouse since `since` ("P0001" → "W1" → figures), for the rebalance input: cartons routed
  // there, cartons it missed as the nearest warehouse, and cartons it shipped for another warehouse that missed them.
  async demand(since: Date) {
    const [rows, events, ctx] = await Promise.all([this.emails.listSince(since), this.listSince(since), this.context()]);
    const demand = new Map<string, Map<string, WarehouseDemand>>();
    const at = (productId: string, warehouseId: string) => {
      const byWarehouse = demand.get(productId) ?? new Map<string, WarehouseDemand>();
      demand.set(productId, byWarehouse);
      const d = byWarehouse.get(warehouseId) ?? { routed: 0, missed: 0, sentForOthers: 0 };
      byWarehouse.set(warehouseId, d);
      return d;
    };
    for (const row of rows) {
      const { lines, decision } = this.read(row, ctx);
      // A request routed to several warehouses counts against the first.
      const warehouseId = decision.routed?.warehouseIds?.[0];
      if (warehouseId) for (const l of lines) at(l.productId, warehouseId).routed += l.quantity;
    }
    for (const e of events) {
      at(e.product_id, e.nearest_warehouse_id).missed += e.quantity;
      if (e.shipped_from_id) at(e.product_id, e.shipped_from_id).sentForOthers += e.quantity;
    }
    return demand;
  }
}
