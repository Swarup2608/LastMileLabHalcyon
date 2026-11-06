// Carrier plan: /api/carrier-plan. Staff only. Once the same-day cutoff has passed, the carrier agent's recommendations
// for every order that's due and has no carrier yet.
import { request } from "./api";
import { jsonOf } from "./emails";

export interface PlanOrder {
  orderId: string;
  // When it was due; missing on a plan made before orders kept it.
  dueDate?: string;
  // null: not routed yet, so the agent lists it for review.
  warehouseName: string | null;
  destination: string;
  region: string | null;
  shippingPriority: string;
}

export type PlanRegion = "Midwest" | "Northeast" | "Southeast" | "West";

// A carrier as the agent was given it: the latest monthly figures from carrier_performance.
export interface PlanCarrier {
  carrierName: string;
  preferredSupplier: boolean;
  // Percent late into each region.
  regionalLateDeliveryRates: Record<PlanRegion, number | null>;
  averageShippingPrice: number | null;
  // "YYYY-MM"
  figuresMonth: string;
  // Orders it can take on this plan, assumed as a third of the plan's orders; null on older plans.
  additionalCapacity?: number | null;
}

// The carrier an order was assigned to. deliveredAt is simulated, 4-5 hours after it was assigned.
export interface OrderAssignment {
  carrier: string;
  assignedAt: string;
  deliveredAt: string;
  delivered: boolean;
}

// Where an assigned order has got to, as the order pages say it.
export function carrierStatus({ delivered, deliveredAt }: OrderAssignment) {
  const when = new Date(deliveredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return delivered ? `Delivered ${when}` : `Out for delivery, by ${when}`;
}

// What the plan was made from, with the carriers staff picked since, by order id.
export interface PlanInput {
  orders: PlanOrder[];
  carriers: PlanCarrier[];
  overrides?: Record<string, { carrier: string; by: string; at: string }>;
}

export interface CarrierPlan {
  // "YYYY-MM-DD"
  date: string;
  // The agent's plain-text report; null when there were no same-day orders.
  report: string | null;
  // The API's validator on the report; null when the agent wasn't asked. Only `dispatch` orders may go out: the
  // dispatch-ready ones, and none at all when there are errors.
  check: { errors: string[]; dispatch: string[] } | null;
  input: PlanInput;
  // By order id: the orders on the plan already assigned to a carrier.
  assignments: Record<string, OrderAssignment>;
  agent: string | null;
  // null: made by the API at the cutoff.
  runBy: string | null;
  createdAt: string;
}

export interface CarrierPlanState {
  // false: FOUNDRY_CARRIER_AGENT_NAME isn't set on the API.
  enabled: boolean;
  today: string;
  cutoff: string;
  timeZone: string;
  cutoffPassed: boolean;
  // Orders waiting for a carrier that aren't on the plan yet; running it again brings them in.
  waiting: string[];
  plan: CarrierPlan | null;
}

export const carrierPlanApi = {
  get: () => request<CarrierPlanState>("/carrier-plan"),
  run: () => request<{ plan: CarrierPlan }>("/carrier-plan/run", { method: "POST" }),
  // override: takes the agent's carriers from a plan that failed validation.
  assign: (override: boolean) =>
    request<{ plan: CarrierPlan; assigned: number; skipped: { orderId: string; reason: string }[] }>("/carrier-plan/assign", { method: "POST", body: { override } }),
  // carrier null: back to the agent's pick.
  choose: (orderId: string, carrier: string | null) =>
    request<{ plan: CarrierPlan }>("/carrier-plan/carrier", { method: "PUT", body: { orderId, carrier } }),
};

// The report is the agent's JSON reply, kept as text. Field names are the agent's own.

// One carrier in an order's ranking.
export interface RankedCarrier {
  rank: number;
  carrier: string;
  price: number | null;
  late_pct: number | null;
  score: number | null;
  tie_break: string | null;
  // false: full by the time this order was assigned, so it went further down the ranking. null: capacity unknown.
  available_at_assignment: boolean | null;
}

export interface SameDayCheck {
  // "N/A", "PENDING_CONFIRMATION", …
  status: string;
  // "HH:MM", the carrier's limits, not booked appointments.
  earliest_pickup: string | null;
  same_day_cutoff: string | null;
  commitment_verified: boolean;
  appointment_booked: boolean;
}

export interface PlanCall {
  id: string;
  warehouse: string | null;
  destination: string | null;
  region: string | null;
  // How the region was found, e.g. "STATE_MAP:IL".
  region_basis: string | null;
  // "SAME_DAY", "HIGH" or "STANDARD".
  priority: string | null;
  ranking: RankedCarrier[];
  // The top of the ranking; assigned differs when that carrier was full.
  recommended: string | null;
  assigned: string | null;
  // What the agent assigned; assigned differs when staff picked another carrier, at chosen_at.
  agent_assigned: string | null;
  chosen_at: string | null;
  assigned_price: number | null;
  capacity_after_assignment: number | null;
  // 100 − the carrier's historical late % into the region, not a prediction.
  on_time_baseline_pct: number | null;
  // "LOW", "MODERATE", "HIGH" or "UNKNOWN".
  risk: string | null;
  same_day: SameDayCheck | null;
  // Codes such as "REGION_CONFIRM", "CAPACITY_REASSIGNED", "SAME_DAY_UNCONFIRMED".
  review: string[];
  dispatch_ready: boolean;
  reason: string | null;
}

export interface CarrierCapacity {
  carrier: string;
  before_batch: number | null;
  assigned: number;
  remaining: number | null;
  // "AVAILABLE", "FULL", …
  status: string;
  order_ids: string[];
}

export interface PickupGroup {
  carrier: string;
  region: string | null;
  earliest_pickup: string | null;
  same_day_cutoff: string | null;
  status: string;
  order_ids: string[];
}

export interface AgentPlan {
  status: string | null;
  basis: string | null;
  allocation_method: string | null;
  orders: PlanCall[];
  capacity: CarrierCapacity[];
  pickup_groups: PickupGroup[];
  summary: {
    total_cost_est: number | null;
    review_order_ids: string[];
    lowest_price: { carrier: string; price: number } | null;
    most_reliable_by_region: { region: string; carrier: string; late_pct: number }[];
    missing_data: string[];
  };
}

const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Whatever the agent wrote as words: it sometimes sends an object where a string belongs.
const plain = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v).map(plain).filter(Boolean).join(" ") : v === null || v === undefined ? "" : String(v);
const strings = (v: unknown) => list<unknown>(v).map(plain).filter(Boolean);

// The agent's plan out of its reply, with anything it left out filled with empties so the page needn't check every
// field, and each order once, as a reply can repeat one; the validator still reports that. null when the reply has no
// JSON with an orders list, and the page shows the reply as written.
export function parseReport(report: string): AgentPlan | null {
  const raw = jsonOf(report) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.orders)) return null;
  const summary = (raw.summary ?? {}) as Record<string, unknown>;
  const orders = list<Record<string, unknown>>(raw.orders);
  return {
    status: text(raw.status),
    basis: text(raw.basis),
    allocation_method: text(raw.allocation_method),
    orders: orders.filter((o, i) => orders.findIndex((x) => x.id === o.id) === i).map((o) => ({
      id: text(o.id) ?? "?",
      warehouse: text(o.warehouse),
      destination: text(o.destination),
      region: text(o.region),
      region_basis: text(o.region_basis),
      priority: text(o.priority),
      ranking: list<RankedCarrier>(o.ranking),
      recommended: text(o.recommended),
      assigned: text(o.assigned),
      agent_assigned: text(o.assigned),
      chosen_at: null,
      assigned_price: number(o.assigned_price),
      capacity_after_assignment: number(o.capacity_after_assignment),
      on_time_baseline_pct: number(o.on_time_baseline_pct),
      risk: text(o.risk),
      same_day: o.same_day && typeof o.same_day === "object" ? (o.same_day as SameDayCheck) : null,
      review: strings(o.review),
      dispatch_ready: o.dispatch_ready === true,
      reason: text(o.reason),
    })),
    capacity: list<CarrierCapacity>(raw.capacity).map((c) => ({ ...c, order_ids: strings(c.order_ids) })),
    pickup_groups: list<PickupGroup>(raw.pickup_groups).map((g) => ({ ...g, order_ids: strings(g.order_ids) })),
    summary: {
      total_cost_est: number(summary.total_cost_est),
      review_order_ids: strings(summary.review_order_ids),
      lowest_price: (summary.lowest_price as AgentPlan["summary"]["lowest_price"]) ?? null,
      most_reliable_by_region: list(summary.most_reliable_by_region),
      missing_data: strings(summary.missing_data),
    },
  };
}

// The plan with staff's picks applied: each order's carrier, price and on-time figure, the capacity and pickup lists, and
// the total. Risk and capacity left were the agent's call on its own carrier, so they're cleared. Where the order's
// ranking has no row for the carrier, its monthly figures are used.
export function withChoices(plan: AgentPlan, { orders: sent, carriers, overrides = {} }: PlanInput): AgentPlan {
  const orders = plan.orders.map((o) => {
    const choice = overrides[o.id];
    if (!choice || choice.carrier === o.assigned) return o;
    const ranked = o.ranking.find((r) => r.carrier === choice.carrier);
    const figures = carriers.find((c) => c.carrierName === choice.carrier);
    const region = o.region ?? sent.find((x) => x.orderId === o.id)?.region;
    const late = ranked?.late_pct ?? (region ? figures?.regionalLateDeliveryRates[words(region) as PlanRegion] : null) ?? null;
    return {
      ...o,
      assigned: choice.carrier,
      chosen_at: choice.at,
      assigned_price: ranked?.price ?? figures?.averageShippingPrice ?? null,
      on_time_baseline_pct: late === null ? null : Math.round((100 - late) * 10) / 10,
      capacity_after_assignment: null,
      risk: null,
    };
  });
  const moved = orders.filter((o) => o.chosen_at);
  if (!moved.length) return plan;
  const isMoved = (id: string) => moved.some((o) => o.id === id);
  const movedTo = (carrier: string) => moved.filter((o) => o.assigned === carrier);

  const capacity = plan.capacity.map((c) => {
    const order_ids = [...c.order_ids.filter((id) => !isMoved(id)), ...movedTo(c.carrier).map((o) => o.id)];
    const change = order_ids.length - c.order_ids.length;
    return { ...c, order_ids, assigned: c.assigned + change, remaining: c.remaining === null ? null : c.remaining - change };
  });
  for (const carrier of new Set(moved.map((o) => o.assigned!))) {
    if (capacity.some((c) => c.carrier === carrier)) continue;
    const order_ids = movedTo(carrier).map((o) => o.id);
    capacity.push({ carrier, before_batch: null, assigned: order_ids.length, remaining: null, status: "STAFF_CHOICE", order_ids });
  }

  const pickup_groups = plan.pickup_groups.map((g) => ({ ...g, order_ids: g.order_ids.filter((id) => !isMoved(id)) })).filter((g) => g.order_ids.length);
  for (const o of moved) {
    const group = pickup_groups.find((g) => g.carrier === o.assigned && g.region === o.region);
    if (group) group.order_ids.push(o.id);
    else pickup_groups.push({ carrier: o.assigned!, region: o.region, earliest_pickup: null, same_day_cutoff: null, status: "STAFF_CHOICE", order_ids: [o.id] });
  }

  const total = orders.reduce((sum, o) => sum + (o.assigned ? (o.assigned_price ?? 0) : 0), 0);
  return { ...plan, orders, capacity, pickup_groups, summary: { ...plan.summary, total_cost_est: Math.round(total * 100) / 100 } };
}

// "PENDING_CONFIRMATION" → "Pending confirmation".
export const words = (code: unknown) => {
  const s = plain(code).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
