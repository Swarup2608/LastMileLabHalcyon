// Simulation: /api/simulation. Staff only. The real carrier and email agents asked about simulated orders, so the
// Simulation page can show them at work. Nothing is saved.
import { request } from "./api";
import type { PlanOrder } from "./carrier-plan";
import type { RebalanceSuggestion } from "./rebalance";

export interface SimulatedCarrierPlan {
  // The agent's JSON reply, kept as text; parseReport (lib/carrier-plan.ts) reads it.
  report: string;
  // The API's validator on the report: only `dispatch` orders may go out, and none when there are errors.
  check: { errors: string[]; dispatch: string[] };
  agent: string | null;
}

// One product as the simulation has it, by warehouse id: cartons available, and the demand it has seen there. routed:
// cartons sent from that warehouse; missed: cartons it lacked as the nearest; sentForOthers: cartons it shipped only
// because the nearest was short.
export interface SimulatedStock {
  productId: string;
  stock: Record<string, number>;
  demand: Record<string, { routed: number; missed: number; sentForOthers: number }>;
}

export const simulationApi = {
  // false: that agent isn't configured on the API.
  status: () => request<{ carrier: boolean; email: boolean; allocation: boolean }>("/simulation"),
  carrier: (orders: Pick<PlanOrder, "orderId" | "warehouseName" | "destination" | "region">[]) =>
    request<SimulatedCarrierPlan>("/simulation/carrier", { method: "POST", body: { orders } }),
  // The allocation agent on the simulation's own stock and demand; the catalogue and warehouses are the real ones.
  rebalance: (products: SimulatedStock[]) =>
    request<Omit<RebalanceSuggestion, "transferDelayDays">>("/simulation/rebalance", { method: "POST", body: { products } }),
  email: (mail: { from: string; subject: string; body: string }) =>
    request<{ agent: string; output: unknown }>("/simulation/email", { method: "POST", body: mail }),
};
