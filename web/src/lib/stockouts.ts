// Stock-outs at the nearest warehouse: /api/stockouts. Staff only. Order lines the warehouse nearest the delivery region
// couldn't cover when the order was routed or flagged, logged by the API as staff (or auto-routing) decide.
import { request } from "./api";

export type Resolution = "rerouted" | "delayed" | "shipped_short";

export interface Stockout {
  id: string;
  requestId: string;
  // "REQ-1A2B3C", as on Resolve.
  orderRef: string;
  productId: string;
  sku: string;
  productName: string;
  region: string;
  nearestWarehouseId: string;
  quantity: number;
  availableAtNearest: number;
  // rerouted: shipped from a farther warehouse. delayed: a new date was offered. shipped_short: routed there anyway.
  resolution: Resolution;
  shippedFromId: string | null;
  extraMiles: number | null;
  decidedAt: string;
}

export const stockoutsApi = {
  list: (days = 30) => request<{ days: number; stockouts: Stockout[] }>("/stockouts", { query: { days } }),
};
