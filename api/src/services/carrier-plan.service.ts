import type { CarrierPlanRepository, CarrierStatsRow } from "../repositories/carrier-plan.repository.js";
import { assignmentOf, toEmailDto, type EmailRepository } from "../repositories/email.repository.js";
import type { SettingsRepository } from "../repositories/settings.repository.js";
import type { WarehouseRepository } from "../repositories/warehouse.repository.js";
import { jsonOf } from "../utils/agent-json.js";
import { tidyReply } from "../utils/carrier-plan-tidy.js";
import { checkPlan } from "../utils/carrier-plan-validate.js";
import { cutoffState } from "../utils/delivery.js";
import type { EmailAgent } from "../utils/foundry.js";
import { badRequest, conflict, notFound } from "../utils/http-error.js";
import { stateCode } from "../utils/regions.js";
import { addressOf } from "../utils/request-address.js";

// How often the API checks whether the cutoff has passed (and whether this month's carrier figures are in).
export const CARRIER_PLAN_INTERVAL_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// An assigned order counts as delivered this long after, plus up to an hour more: simulated, with no tracking feed yet.
const DELIVERY_HOURS = 4;

// One order as the carrier agent gets it.
export interface PlanOrder {
  orderId: string;
  // Its order_requests row. Not sent to the agent, and not set on a simulated order.
  requestId?: string;
  // When it was due: earlier than the plan's date means it missed its carrier. Not sent to the agent.
  dueDate?: string;
  // null on a plan from before only routed orders went on it: the agent lists it as needing review.
  warehouseName: string | null;
  destination: string;
  region: string | null;
  // High: overdue, so it's allocated right after today's same-day orders.
  shippingPriority: "Same-day" | "High" | "Standard";
}

export interface PlanCarrier {
  carrierName: string;
  preferredSupplier: boolean;
  // Percent late into each region, from the month in figuresMonth.
  regionalLateDeliveryRates: Record<"Midwest" | "Northeast" | "Southeast" | "West", number | null>;
  averageShippingPrice: number | null;
  figuresMonth: string;
  // Not in the dataset: the agent must say so rather than guess.
  // Orders it can take on this plan. An assumption, as the dataset has no capacity: see CAPACITY_SHARE. null on older plans.
  additionalCapacity: number | null;
  earliestPickup: null;
  latestSameDayPickup: null;
  sameDayServiceAvailable: null;
}

// A carrier staff picked for an order in place of the agent's. by: the staff member.
export interface CarrierChoice {
  carrier: string;
  by: string;
  at: string;
}

export interface PlanInput {
  planDate: string;
  orders: PlanOrder[];
  carriers: PlanCarrier[];
  // By order id. Never sent to the agent or checked by the validator: the report stays the agent's own.
  overrides?: Record<string, CarrierChoice>;
}

const num = (v: string | null) => (v === null ? null : Number(v));
// A carrier's capacity on a plan: the plan's orders divided by this, rounded up. Assumed; the dataset doesn't record it.
const CAPACITY_SHARE = 3;

const toCarrier = (c: CarrierStatsRow, orderCount: number): PlanCarrier => ({
  carrierName: c.carrier_id,
  preferredSupplier: c.preferred,
  regionalLateDeliveryRates: {
    Midwest: num(c.midwest_late_pct),
    Northeast: num(c.northeast_late_pct),
    Southeast: num(c.southeast_late_pct),
    West: num(c.west_late_pct),
  },
  averageShippingPrice: num(c.avg_rate_usd),
  figuresMonth: new Date(c.period_month).toISOString().slice(0, 7),
  additionalCapacity: Math.ceil(orderCount / CAPACITY_SHARE),
  earliestPickup: null,
  latestSameDayPickup: null,
  sameDayServiceAvailable: null,
});

const AGENT_PRIORITY = { "Same-day": "SAME_DAY", High: "HIGH", Standard: "STANDARD" } as const;

// The shape the Foundry agent's instructions define: orders[] {id, warehouse, destination, priority}, carriers[] {name,
// price, late_pct, capacity, ...} and a region_map. An unrouted order is sent as "Unrouted", since the agent refuses a
// batch with a missing warehouse.
const agentPayload = ({ orders, carriers }: Pick<PlanInput, "orders" | "carriers">) => ({
  orders: orders.map((o) => ({
    id: o.orderId,
    warehouse: o.warehouseName ?? "Unrouted",
    destination: o.destination,
    priority: AGENT_PRIORITY[o.shippingPriority],
  })),
  carriers: carriers.map((c) => ({
    name: c.carrierName,
    price: c.averageShippingPrice,
    late_pct: Object.fromEntries(Object.entries(c.regionalLateDeliveryRates).map(([region, pct]) => [region.toUpperCase(), pct])),
    capacity: c.additionalCapacity,
    pickup_start: c.earliestPickup,
    pickup_cutoff: c.latestSameDayPickup,
    same_day_service: c.sameDayServiceAvailable,
    same_day_commitment: null,
  })),
  region_map: Object.fromEntries(orders.filter((o) => o.region).map((o) => [o.destination, o.region!.toUpperCase()])),
});

// The agent's reply as the report's text.
const textOf = (output: unknown) => (typeof output === "string" ? output.trim() : JSON.stringify(output, null, 2));

// The validator's verdict on a stored plan, checked against what the agent was sent: each carrier's capacity before the
// batch (null while the dataset has none) and the order ids.
export const checkOf = (input: Pick<PlanInput, "orders" | "carriers">, report: string) =>
  checkPlan(
    report,
    Object.fromEntries(input.carriers.map((c) => [c.carrierName, c.additionalCapacity])),
    input.orders.map((o) => o.orderId),
  );

// Once the same-day cutoff has passed no more orders join today's same-day run, so the API sends them, with each
// carrier's latest late-delivery rates and prices, to the carrier agent (FOUNDRY_CARRIER_AGENT_NAME) and keeps its
// report for contributors and admins. The scoring rules and report format are in the agent's Foundry instructions.
export class CarrierPlanService {
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly plans: CarrierPlanRepository,
    private readonly emails: EmailRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly settings: SettingsRepository,
    // Undefined when FOUNDRY_CARRIER_AGENT_NAME isn't set.
    private readonly agent?: EmailAgent,
    private readonly agentName?: string,
  ) {}

  get enabled() {
    return !!this.agent;
  }

  async status(now = new Date()) {
    const rule = await this.settings.deliveryRule();
    return { rule, ...cutoffState(now, rule) };
  }

  // Every routed order with no carrier yet, whenever it's due, however it came in. Ready to route isn't enough: a carrier
  // collects from a warehouse.
  async input(now = new Date()): Promise<PlanInput> {
    const { rule, today } = await this.status(now);
    const [rows, warehouses, carriers] = await Promise.all([
      this.emails.listUnassigned(),
      this.warehouses.list(),
      this.plans.carrierStats(),
    ]);
    const nameOf = (id: string) => warehouses.find((w) => w.warehouse_id === id)?.warehouse_name ?? id;

    const orders: PlanOrder[] = [];
    for (const row of rows) {
      const dto = toEmailDto(row, [], rule);
      const edits = (dto.edits ?? {}) as { routed?: { warehouseIds?: string[] } };
      if (!edits.routed) continue;
      const due = dto.expectedDelivery;

      const { city, state, region } = addressOf(dto);
      const ids = edits.routed?.warehouseIds ?? [];
      orders.push({
        // As staff see it on Resolve.
        orderId: `REQ-${row.message_id.slice(-6).toUpperCase()}`,
        requestId: row.message_id,
        dueDate: due.date,
        warehouseName: ids.length ? ids.map(nameOf).join(" and ") : null,
        destination: [city, stateCode(state) ?? state].filter(Boolean).join(", ") || "Unknown",
        region,
        shippingPriority: due.date < today ? "High" : due.date === today && due.sameDay ? "Same-day" : "Standard",
      });
    }
    return { planDate: today, orders, carriers: carriers.map((c) => toCarrier(c, orders.length)) };
  }

  // Orders waiting for a carrier that aren't on the plan, as they came in after it ran. Run again brings them in.
  async waiting(planned: Pick<PlanOrder, "orderId">[] = [], now = new Date()) {
    const { orders } = await this.input(now);
    return orders.map((o) => o.orderId).filter((id) => !planned.some((p) => p.orderId === id));
  }

  // Makes today's plan and stores it; a run still in flight is shared. by: the staff member, null for the scheduler.
  run(by: string | null, now = new Date()) {
    this.running ??= this.runOnce(by, now).finally(() => (this.running = undefined));
    return this.running as Promise<{ date: string; orders: number }>;
  }

  private async runOnce(by: string | null, now: Date) {
    const input = await this.input(now);
    let report: string | null = null;
    if (input.orders.length) {
      if (!this.agent) throw new Error("carrier agent not configured");
      report = await this.ask(input);
      // Every reply is validated; a plan with errors is kept for staff to see, but none of its orders is dispatched.
      const { errors } = checkOf(input, report);
      if (errors.length) console.warn(`carrier plan: ${input.planDate} failed validation, nothing dispatched:`, errors);
    }
    // Staff's picks outlast a re-run, for the orders still on the plan. Read last, as the agent can take a while.
    const earlier = ((await this.plans.get(input.planDate))?.input as PlanInput | undefined)?.overrides ?? {};
    const overrides = Object.fromEntries(Object.entries(earlier).filter(([id]) => input.orders.some((o) => o.orderId === id)));
    await this.plans.save({ date: input.planDate, input: { ...input, overrides }, report, agent: report ? (this.agentName ?? null) : null, runBy: by });
    return { date: input.planDate, orders: input.orders.length };
  }

  // Staff's carrier for an order on today's plan, whatever the agent assigned and whether or not the order is cleared,
  // until the order is assigned; null goes back to the agent's. Returns the plan's date.
  async choose(orderId: string, carrier: string | null, by: string, now = new Date()) {
    const { today } = await this.status(now);
    const input = (await this.plans.get(today))?.input as PlanInput | undefined;
    const order = input?.orders.find((o) => o.orderId === orderId);
    if (!input || !order) throw notFound("That order isn't on today's carrier plan");
    if (order.requestId && (await this.emails.assignments([order.requestId])).length) throw conflict("That order is already assigned to a carrier");
    if (carrier !== null && !input.carriers.some((c) => c.carrierName === carrier)) throw badRequest("Unknown carrier");
    const { [orderId]: _replaced, ...overrides } = input.overrides ?? {};
    if (carrier !== null) overrides[orderId] = { carrier, by, at: now.toISOString() };
    await this.plans.saveInput(today, { ...input, overrides });
    return today;
  }

  // Assigns today's plan to its carriers and sets when each order counts as delivered. Staff pressing Assign is the
  // review, so an order under review goes too. From a plan that failed validation only staff's own picks go, unless
  // they override it having seen the errors. Orders with no warehouse or carrier stay for the next plan. An order
  // assigned already is left as it is.
  async assign(by: string, override = false, now = new Date(), random = Math.random) {
    const { today } = await this.status(now);
    const plan = await this.plans.get(today);
    if (!plan?.report) throw notFound("There's no carrier plan to assign today");
    const input = plan.input as PlanInput;
    const failed = checkOf(input, plan.report).errors.length > 0;
    const reply = jsonOf(plan.report) as { orders?: { id?: unknown; assigned?: unknown }[] } | null;
    const agentPick = (orderId: string) => (failed && !override ? undefined : reply?.orders?.find((o) => o.id === orderId)?.assigned);

    const assigned: string[] = [];
    const skipped: { orderId: string; reason: string }[] = [];
    for (const order of input.orders) {
      const carrier = input.overrides?.[order.orderId]?.carrier ?? agentPick(order.orderId);
      const known = input.carriers.find((c) => c.carrierName === carrier)?.carrierName;
      const reason = !order.requestId ? "run the plan again first" : !order.warehouseName ? "not routed to a warehouse" : !known ? "no carrier" : null;
      if (reason) {
        skipped.push({ orderId: order.orderId, reason });
        continue;
      }
      const deliveredAt = new Date(now.getTime() + (DELIVERY_HOURS + random()) * HOUR_MS);
      if (await this.emails.assignCarrier(order.requestId!, known!, by, now, deliveredAt)) assigned.push(order.orderId);
    }
    return { date: today, assigned, skipped };
  }

  // The orders on a plan already assigned to a carrier, by order id.
  async assignments({ orders }: PlanInput) {
    const rows = await this.emails.assignments(orders.flatMap((o) => o.requestId ?? []));
    const byRequest = new Map(rows.map((r) => [r.request_id, assignmentOf(r)]));
    return Object.fromEntries(orders.flatMap((o) => (o.requestId && byRequest.get(o.requestId) ? [[o.orderId, byRequest.get(o.requestId)!]] : [])));
  }

  // Only the data: what to do with it is in the agent's own instructions.
  private async ask(input: Pick<PlanInput, "orders" | "carriers">) {
    const reply = await this.agent!.ask(JSON.stringify(agentPayload(input), null, 2));
    return tidyReply(textOf(reply.output), input.orders.map((o) => o.orderId), input.carriers);
  }

  // The agent's plan for orders it is handed, with the validator's verdict. Nothing is saved and the cutoff isn't
  // waited for: the web simulation's live view of the agent at work, on simulated orders.
  async preview(orders: PlanOrder[], now = new Date()) {
    if (!this.agent) throw new Error("carrier agent not configured");
    const { today } = await this.status(now);
    const input: PlanInput = { planDate: today, orders, carriers: (await this.plans.carrierStats()).map((c) => toCarrier(c, orders.length)) };
    const report = await this.ask(input);
    return { input, report, check: checkOf(input, report), agent: this.agentName ?? null };
  }

  // Keeps this month's carrier figures in, and makes today's plan the first time the cutoff has passed.
  async tick(now = new Date()) {
    // A failed refresh leaves last month's figures in use; it doesn't hold up the plan.
    await this.plans.refreshMonthIfMissing().then(
      (done) => done && console.log("carrier plan: refreshed this month's carrier figures"),
      (err) => console.error("carrier figures refresh failed", err),
    );
    if (!this.agent) return;
    const { today, passed } = await this.status(now);
    if (!passed || (await this.plans.get(today))) return;
    const { orders } = await this.run(null, now);
    console.log(`carrier plan: ${today} made for ${orders} same-day orders`);
  }

  // Runs now and then every intervalMs; returns a stop function. Failures are logged and retried next time.
  schedule(intervalMs = CARRIER_PLAN_INTERVAL_MS) {
    const tick = () => this.tick().catch((err) => console.error("carrier plan failed", err));
    void tick();
    const timer = setInterval(tick, intervalMs);
    // Never keeps the process alive on its own.
    timer.unref();
    return () => clearInterval(timer);
  }
}
