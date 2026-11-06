// Reads the allocation agent's rebalance reply: its JSON (repaired like the other agents' replies), in the output schema
// the agent's instructions give, checked against what it was sent. Nothing here is saved or applied: staff see the
// suggestion, change it if they like, and the warnings tell them where the agent's figures don't add up.
import { jsonOf } from "./agent-json.js";

export type Decision = "YES" | "NO" | "REVIEW";
export type Risk = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

// What the agent is sent, one product at a time; nulls are figures the dataset doesn't have.
export interface RebalanceWarehouse {
  id: string;
  orders: number | null;
  outOfStockPercentage: number | null;
  // Cartons ordered over the window for which this was the nearest warehouse and it didn't have them.
  stockoutsAtNearest?: number;
  presentValue: number | null;
  availableStock: number;
  reservedStock: number | null;
  safetyBuffer: number | null;
  // Cartons in transit from an applied rebalance; arrivesBeforeDemand is unknown (null) since demand has no dates.
  incomingStock: { quantity: number; arrivesAt?: string; arrivesBeforeDemand: boolean | null } | null;
  distanceToCustomer: number | null;
}

export interface RebalanceRoute {
  from: string;
  to: string;
  distance: number | null;
  cost: number | null;
  deliveryTime: number | null;
  deliveryTimeUnit: "days" | null;
}

export interface RebalanceProductInput {
  // The SKU: product names aren't unique, so the agent's reply is matched back on this.
  product: string;
  productId: string;
  productName: string;
  totalAvailability: number;
  warehouses: RebalanceWarehouse[];
  routes: RebalanceRoute[];
}

export interface RebalanceInput {
  settings: { orderUnit: string; oosBasis: string | null; presentValueDefinition: string };
  products: RebalanceProductInput[];
}

export interface Transfer {
  source: string;
  destination: string;
  quantity: number;
  distance: number | null;
  reason: string;
}

export interface ProductSuggestion {
  product: string;
  decision: Decision;
  nearestWarehouse: string;
  stockoutRisk: Risk;
  affectedWarehouses: string[];
  reallocationReason: string;
  recommendedTransfers: Transfer[];
  expectedImpact: string;
  remainingShortage: number | null;
  notes: string[];
}

export interface RebalanceSummary {
  totalProducts: number;
  reallocationRequired: number;
  noReallocationRequired: number;
  reviewRequired: number;
  totalTransferUnits: number | null;
  estimatedOrdersAffected: number | null;
  overallOutOfStockPercentage: number | null;
  unresolvedProducts: string[];
}

export interface RebalancePlan {
  products: ProductSuggestion[];
  summary: RebalanceSummary;
  contributorNotes: string[];
}

const DECISIONS: Decision[] = ["YES", "NO", "REVIEW"];
const RISKS: Risk[] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const upper = <T extends string>(v: unknown, allowed: T[]) => allowed.find((a) => a === text(v).toUpperCase());

// The counts and totals the summary must agree with, from the products themselves.
export function summaryOf(products: ProductSuggestion[], agent: Partial<RebalanceSummary> = {}): RebalanceSummary {
  const count = (d: Decision) => products.filter((p) => p.decision === d).length;
  return {
    totalProducts: products.length,
    reallocationRequired: count("YES"),
    noReallocationRequired: count("NO"),
    reviewRequired: count("REVIEW"),
    totalTransferUnits: products.reduce((s, p) => s + p.recommendedTransfers.reduce((t, x) => t + x.quantity, 0), 0),
    estimatedOrdersAffected: agent.estimatedOrdersAffected ?? null,
    overallOutOfStockPercentage: agent.overallOutOfStockPercentage ?? null,
    unresolvedProducts: products.filter((p) => p.decision === "REVIEW" || (p.remainingShortage ?? 0) > 0).map((p) => p.product),
  };
}

// The agent's reply in the output schema, with the problems found. A product the agent left out, or a reply that isn't
// JSON, becomes REVIEW with nothing to transfer, so staff still see every product they asked about. Transfers that
// can't happen (unknown warehouse, to itself, no quantity) are dropped with a warning; ones that move more than the
// source has are kept and warned about, since staff may correct the quantity.
export function readPlan(reply: string, input: RebalanceInput): { plan: RebalancePlan; warnings: string[] } {
  const warnings: string[] = [];
  const raw = jsonOf(reply) as Record<string, unknown> | null;
  const rawProducts = raw && typeof raw === "object" && Array.isArray(raw.products) ? (raw.products as Record<string, unknown>[]) : null;
  if (!rawProducts) warnings.push("The agent's reply isn't in the expected JSON shape; every product needs review.");

  const byProduct = new Map<string, Record<string, unknown>>();
  for (const p of rawProducts ?? []) {
    const key = text(p?.product);
    const known = input.products.find((i) => i.product === key || i.productName === key || i.productId === key);
    if (!known) warnings.push(`The agent answered for "${key || "?"}", which it wasn't sent; ignored.`);
    else if (byProduct.has(known.product)) warnings.push(`${known.product}: answered twice; the first answer is kept.`);
    else byProduct.set(known.product, p);
  }

  const products = input.products.map((sent): ProductSuggestion => {
    const p = byProduct.get(sent.product);
    if (!p) {
      if (rawProducts) warnings.push(`${sent.product}: the agent didn't answer for it.`);
      return {
        product: sent.product,
        decision: "REVIEW",
        nearestWarehouse: "",
        stockoutRisk: "UNKNOWN",
        affectedWarehouses: [],
        reallocationReason: "No suggestion from the agent.",
        recommendedTransfers: [],
        expectedImpact: "",
        remainingShortage: null,
        notes: [],
      };
    }
    const ids = new Set(sent.warehouses.map((w) => w.id));
    const available = new Map(sent.warehouses.map((w) => [w.id, w.availableStock]));
    const transfers: Transfer[] = [];
    for (const t of Array.isArray(p.recommendedTransfers) ? (p.recommendedTransfers as Record<string, unknown>[]) : []) {
      const source = text(t?.source);
      const destination = text(t?.destination);
      const quantity = number(t?.quantity);
      if (!ids.has(source) || !ids.has(destination)) {
        warnings.push(`${sent.product}: transfer ${source || "?"} → ${destination || "?"} names a warehouse it wasn't sent; dropped.`);
      } else if (source === destination) {
        warnings.push(`${sent.product}: transfer from ${source} to itself; dropped.`);
      } else if (quantity === null || quantity <= 0) {
        warnings.push(`${sent.product}: transfer ${source} → ${destination} has no quantity; dropped.`);
      } else {
        const route = sent.routes.find((r) => r.from === source && r.to === destination);
        transfers.push({
          source,
          destination,
          quantity: Math.round(quantity),
          distance: number(t?.distance) ?? route?.distance ?? null,
          reason: text(t?.reason),
        });
      }
    }
    for (const id of ids) {
      const out = transfers.filter((t) => t.source === id).reduce((s, t) => s + t.quantity, 0);
      if (out > (available.get(id) ?? 0))
        warnings.push(`${sent.product}: ${out} out of ${id}, which has ${available.get(id)} available.`);
    }
    let decision = upper(p.decision, DECISIONS) ?? "REVIEW";
    if (decision === "YES" && !transfers.length) {
      warnings.push(`${sent.product}: rebalance recommended but no usable transfer; marked for review.`);
      decision = "REVIEW";
    }
    if (decision === "NO" && transfers.length) warnings.push(`${sent.product}: no rebalance recommended, yet transfers are listed.`);
    const remaining = number(p.remainingShortage);
    return {
      product: sent.product,
      decision,
      nearestWarehouse: text(p.nearestWarehouse),
      stockoutRisk: upper(p.stockoutRisk, RISKS) ?? "UNKNOWN",
      affectedWarehouses: strings(p.affectedWarehouses).filter((id) => ids.has(id)),
      reallocationReason: text(p.reallocationReason),
      recommendedTransfers: transfers,
      expectedImpact: text(p.expectedImpact),
      remainingShortage: remaining === null ? null : Math.max(0, remaining),
      notes: strings(p.notes),
    };
  });

  const agentSummary = (raw?.summary ?? {}) as Record<string, unknown>;
  const pct = number(agentSummary.overallOutOfStockPercentage);
  const summary = summaryOf(products, {
    estimatedOrdersAffected: number(agentSummary.estimatedOrdersAffected),
    overallOutOfStockPercentage: pct === null ? null : Math.min(100, Math.max(0, pct)),
  });
  for (const key of ["reallocationRequired", "noReallocationRequired", "reviewRequired", "totalTransferUnits"] as const) {
    const said = number(agentSummary[key]);
    if (rawProducts && said !== null && said !== summary[key]) warnings.push(`Summary ${key} was ${said}; the products add up to ${summary[key]}.`);
  }
  return { plan: { products, summary, contributorNotes: strings(raw?.contributorNotes) }, warnings };
}
