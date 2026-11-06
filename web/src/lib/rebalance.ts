// Rebalance: /api/rebalance. Staff only. The allocation agent's suggested stock transfers between warehouses, for some
// products or all of them. Staff review the suggestion, change it, and apply it: the transfers are saved, the cartons
// leave the source at once and reach the destination after STOCK_TRANSFER_DELAY_DAYS (immediately when 0).
import { request } from "./api";

export type Decision = "YES" | "NO" | "REVIEW";
export type Risk = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

// A warehouse as the agent was given it; nulls are figures the dataset doesn't have.
export interface RebalanceWarehouse {
  id: string;
  // Cartons it should have served over the last 30 days: routed there, plus missed there as the nearest warehouse.
  orders: number | null;
  // Percent of those orders it missed as the nearest warehouse.
  outOfStockPercentage: number | null;
  // Cartons it missed as the nearest warehouse.
  stockoutsAtNearest?: number;
  presentValue: number | null;
  availableStock: number;
  reservedStock: number | null;
  // The reorder point.
  safetyBuffer: number | null;
  // Cartons on the way from an applied rebalance.
  incomingStock: { quantity: number; arrivesAt?: string } | null;
  distanceToCustomer: number | null;
}

export interface RebalanceRoute {
  from: string;
  to: string;
  distance: number | null;
}

export interface RebalanceProductInput {
  // The SKU.
  product: string;
  productId: string;
  productName: string;
  totalAvailability: number;
  warehouses: RebalanceWarehouse[];
  routes: RebalanceRoute[];
}

export interface Transfer {
  source: string;
  destination: string;
  quantity: number;
  distance: number | null;
  reason: string;
}

export interface ProductSuggestion {
  // The SKU, as sent.
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

export interface RebalanceSuggestion {
  input: { settings: { orderUnit: string; oosBasis: string | null }; products: RebalanceProductInput[] };
  plan: {
    products: ProductSuggestion[];
    summary: {
      totalProducts: number;
      reallocationRequired: number;
      noReallocationRequired: number;
      reviewRequired: number;
      totalTransferUnits: number | null;
      estimatedOrdersAffected: number | null;
      overallOutOfStockPercentage: number | null;
      unresolvedProducts: string[];
    };
    contributorNotes: string[];
  };
  // Where the agent's reply didn't add up: dropped transfers, products it skipped, a summary that didn't match.
  warnings: string[];
  // STOCK_TRANSFER_DELAY_DAYS: days before applied transfers reach their destination; 0 is immediate.
  transferDelayDays: number;
}

// A transfer staff applied, as saved. Its cartons left the source when applied and reach the destination at arrivesAt.
export interface StockTransfer {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  source: string;
  destination: string;
  quantity: number;
  status: "in_transit" | "completed";
  // edited: staff changed or added it; suggested: the agent's transfer as given.
  origin: "suggested" | "edited";
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  arrivesAt: string;
  completedAt: string | null;
}

export interface ApplyTransfer {
  productId: string;
  source: string;
  destination: string;
  quantity: number;
  origin: "suggested" | "edited";
  reason?: string;
}

export const rebalanceApi = {
  // productIds left out: every product (Rebalance all).
  suggest: (productIds?: string[]) =>
    request<RebalanceSuggestion>("/rebalance/suggest", { method: "POST", body: productIds ? { productIds } : {} }),
  // Saves the transfers; all or nothing (409 when a source no longer has the cartons).
  apply: (transfers: ApplyTransfer[]) =>
    request<{ delayDays: number; transfers: StockTransfer[] }>("/rebalance/apply", { method: "POST", body: { transfers } }),
  // Applied in the last `days` days, plus any still in transit.
  transfers: (days = 30) =>
    request<{ days: number; delayDays: number; transfers: StockTransfer[] }>("/rebalance/transfers", { query: { days } }),
};
