import { toProductDtos, type ProductDto, type ProductRepository } from "../repositories/product.repository.js";
import { toWarehouseDto, type WarehouseRepository } from "../repositories/warehouse.repository.js";
import type { StockTransferRepository, TransferRow } from "../repositories/stock-transfer.repository.js";
import type { EmailAgent } from "../utils/foundry.js";
import { ordersOf, type StockoutService, type WarehouseDemand } from "./stockout.service.js";
import {
  readPlan,
  summaryOf,
  type RebalanceInput,
  type RebalancePlan,
  type RebalanceProductInput,
  type RebalanceRoute,
  type RebalanceWarehouse,
} from "../utils/rebalance-validate.js";

// Demand and stock-outs are counted over this many days.
export const DEMAND_DAYS = 30;
// Products per agent call: Rebalance all sends every product, in batches of this size at once.
export const BATCH_SIZE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

type Warehouse = ReturnType<typeof toWarehouseDto>;
type MilesKey = keyof Warehouse["milesToRegion"];

// Cartons on the way to a warehouse, and when the last of them arrives; null when none are.
const incomingOf = (rows: Pick<TransferRow, "quantity" | "arrives_at">[]) =>
  rows.length
    ? {
        quantity: rows.reduce((s, t) => s + t.quantity, 0),
        arrivesAt: new Date(Math.max(...rows.map((t) => new Date(t.arrives_at).getTime()))).toISOString(),
        arrivesBeforeDemand: null,
      }
    : null;

// One product's stock and demand in the web simulation, by warehouse id: cartons available, and the figures
// WarehouseDemand describes.
export interface SimulatedProduct {
  productId: string;
  stock: Record<string, number>;
  demand: Record<string, WarehouseDemand>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// One product as the agent gets it. Warehouses: the ones that stock it or had orders for it, including a nearest
// warehouse that missed orders without stocking it. orders: cartons the warehouse should have served (routed there,
// plus missed there as the nearest, less shipped there for a nearer one that was short); outOfStockPercentage: the
// share of those it missed. Routes: from each with
// stock above its reorder point to each that is short (below its reorder point, or with more orders than stock); the
// dataset has no warehouse-to-warehouse distances, so a route's distance is the source's miles to the destination's
// region, and cost and delivery time are unknown.
export function productInput(
  p: ProductDto,
  warehouses: Warehouse[],
  demand: Map<string, WarehouseDemand> | undefined,
  // This product's transfers still on the way, from an earlier rebalance.
  inTransit: Pick<TransferRow, "destination_id" | "quantity" | "arrives_at">[] = [],
): RebalanceProductInput {
  const ids = new Set([
    ...p.stock.map((s) => s.warehouseId),
    ...[...(demand ?? [])].filter(([, d]) => ordersOf(d) > 0 || d.missed > 0).map(([id]) => id),
  ]);
  const rows: RebalanceWarehouse[] = warehouses
    .filter((w) => ids.has(w.warehouseId))
    .map((w) => {
      const s = p.stock.find((x) => x.warehouseId === w.warehouseId);
      const available = s?.available ?? 0;
      const d = demand?.get(w.warehouseId);
      const orders = d ? ordersOf(d) : 0;
      const missed = d?.missed ?? 0;
      return {
        id: w.warehouseId,
        orders,
        outOfStockPercentage: orders ? round1((Math.min(missed, orders) / orders) * 100) : 0,
        stockoutsAtNearest: missed,
        presentValue: Math.round(available * p.unitPriceUsd * 100) / 100,
        availableStock: available,
        reservedStock: s?.reserved ?? 0,
        safetyBuffer: s ? s.reorderPoint : null,
        incomingStock: incomingOf(inTransit.filter((t) => t.destination_id === w.warehouseId)),
        distanceToCustomer: p.clientRegion ? (w.milesToRegion[p.clientRegion as MilesKey] ?? null) : null,
      };
    });
  const short = (w: RebalanceWarehouse) =>
    w.availableStock < (w.safetyBuffer ?? 0) || (w.orders ?? 0) > w.availableStock || (w.stockoutsAtNearest ?? 0) > 0;
  const spare = (w: RebalanceWarehouse) => w.availableStock > (w.safetyBuffer ?? 0) && !short(w);
  const routes: RebalanceRoute[] = [];
  for (const from of rows.filter(spare)) {
    const source = warehouses.find((w) => w.warehouseId === from.id)!;
    for (const to of rows.filter(short)) {
      const region = warehouses.find((w) => w.warehouseId === to.id)?.region as MilesKey | null;
      routes.push({
        from: from.id,
        to: to.id,
        distance: region ? (source.milesToRegion[region] ?? null) : null,
        cost: null,
        deliveryTime: null,
        deliveryTimeUnit: null,
      });
    }
  }
  return {
    product: p.sku,
    productId: p.productId,
    productName: p.productName,
    totalAvailability: rows.reduce((s, w) => s + w.availableStock, 0),
    warehouses: rows,
    routes,
  };
}

const SETTINGS: RebalanceInput["settings"] = {
  orderUnit: "cartons",
  oosBasis: `share of the last ${DEMAND_DAYS} days' orders for which this was the nearest warehouse and it was out of stock (stockoutsAtNearest cartons), so they shipped from farther away or were delayed`,
  presentValueDefinition: "available cartons × unit price, in USD",
};

// Inventory's Rebalance: sends products' stock, recent demand and possible routes to the allocation agent
// (FOUNDRY_ALLOCATION_IQ_AGENT_NAME) and returns its suggested transfers. Nothing is saved or moved: staff review the
// suggestion, edit it, and decide. The decision rules and output schema are in the agent's Foundry instructions.
export class RebalanceService {
  constructor(
    private readonly products: ProductRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly stockouts: StockoutService,
    private readonly transfers: StockTransferRepository,
    // Undefined when FOUNDRY_ALLOCATION_IQ_AGENT_NAME isn't set.
    private readonly agent?: EmailAgent,
  ) {}

  get enabled() {
    return !!this.agent;
  }

  // The agent's input for the given products (every product stocked somewhere when productIds is undefined); unknown
  // ids are left out.
  async input(productIds?: string[], now = new Date()): Promise<RebalanceInput> {
    const [productRows, warehouseRows, demand, inTransit] = await Promise.all([
      this.products.listWithStock(null),
      this.warehouses.list(),
      this.stockouts.demand(new Date(now.getTime() - DEMAND_DAYS * DAY_MS)),
      this.transfers.inTransit(),
    ]);
    const all = toProductDtos(productRows);
    const wanted = productIds ? new Set(productIds) : null;
    const products = all.filter((p) => (wanted ? wanted.has(p.productId) : p.stock.length > 0));
    const warehouses = warehouseRows.map(toWarehouseDto);
    return { settings: SETTINGS, products: products.map((p) =>
        productInput(p, warehouses, demand.get(p.productId), inTransit.filter((t) => t.product_id === p.productId)),
      ),
    };
  }

  // The agent's input for products as the web simulation has them: the catalogue, warehouses, reorder points, prices and
  // distances are the real ones, but the stock and the demand are the simulation's (no orders, stock-outs or transfers
  // are read from the database). Unknown products are left out.
  async simulatedInput(sim: SimulatedProduct[]): Promise<RebalanceInput> {
    const [productRows, warehouseRows] = await Promise.all([this.products.listWithStock(null), this.warehouses.list()]);
    const warehouses = warehouseRows.map(toWarehouseDto);
    const bySim = new Map(sim.map((s) => [s.productId, s]));
    const products = toProductDtos(productRows)
      .filter((p) => bySim.has(p.productId))
      .map((p) => {
        const s = bySim.get(p.productId)!;
        const stock = p.stock.map((x) => {
          const available = s.stock[x.warehouseId];
          return available === undefined ? x : { ...x, onHand: available, reserved: 0, available };
        });
        return productInput({ ...p, stock }, warehouses, new Map(Object.entries(s.demand)));
      });
    return { settings: SETTINGS, products };
  }

  // The agent's suggestion for the products, read and checked against what it was sent. Large requests go in batches
  // whose answers are merged into one plan.
  async suggest(productIds?: string[]) {
    return this.suggestFor(await this.input(productIds));
  }

  async suggestFor(input: RebalanceInput) {
    if (!this.agent) throw new Error("allocation agent not configured");
    const batches: RebalanceInput[] = [];
    for (let i = 0; i < input.products.length; i += BATCH_SIZE)
      batches.push({ settings: input.settings, products: input.products.slice(i, i + BATCH_SIZE) });

    const answers = await Promise.all(
      batches.map(async (batch) => {
        // Only the data: what to do with it is in the agent's own instructions.
        const reply = await this.agent!.ask(JSON.stringify(batch, null, 2));
        const text = typeof reply.output === "string" ? reply.output : JSON.stringify(reply.output);
        const orders = batch.products.reduce((s, p) => s + p.warehouses.reduce((t, w) => t + (w.orders ?? 0), 0), 0);
        return { ...readPlan(text, batch), orders };
      }),
    );

    const products = answers.flatMap((a) => a.plan.products);
    const summaries = answers.map((a) => a.plan.summary);
    const known = <K extends "estimatedOrdersAffected" | "overallOutOfStockPercentage">(k: K) => summaries.every((s) => s[k] !== null);
    const totalOrders = answers.reduce((s, a) => s + a.orders, 0);
    const plan: RebalancePlan = {
      products,
      summary: summaryOf(products, {
        estimatedOrdersAffected: known("estimatedOrdersAffected")
          ? summaries.reduce((s, x) => s + x.estimatedOrdersAffected!, 0)
          : null,
        // Each batch's percentage weighted by its orders.
        overallOutOfStockPercentage:
          answers.length === 1
            ? summaries[0].overallOutOfStockPercentage
            : known("overallOutOfStockPercentage") && totalOrders
              ? round1(answers.reduce((s, a) => s + a.plan.summary.overallOutOfStockPercentage! * a.orders, 0) / totalOrders)
              : null,
      }),
      contributorNotes: [...new Set(answers.flatMap((a) => a.plan.contributorNotes))],
    };
    return { input, plan, warnings: answers.flatMap((a) => a.warnings) };
  }
}
