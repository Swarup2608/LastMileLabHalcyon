// The carrier plan: which orders are today's final same-day ones, what the carrier agent is sent, and that its report is
// kept. Runs against an in-memory Postgres (pg-mem) with a fake agent.
import { readFileSync } from "node:fs";
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { CarrierPlanRepository } from "../src/repositories/carrier-plan.repository.js";
import { assignmentOf, EmailRepository } from "../src/repositories/email.repository.js";
import { SettingsRepository } from "../src/repositories/settings.repository.js";
import { WarehouseRepository } from "../src/repositories/warehouse.repository.js";
import { CarrierPlanService, type PlanInput } from "../src/services/carrier-plan.service.js";
import type { EmailAgent } from "../src/utils/foundry.js";

// 29 Oct 2026 in New York (UTC-4): 07:30 is before the default 08:00 cutoff, 09:00 after it.
const BEFORE_CUTOFF = new Date("2026-10-29T11:30:00Z");
const AFTER_CUTOFF = new Date("2026-10-29T13:00:00Z");
const STAFF = "00000000-0000-0000-0000-000000000001";

// A plan the validator passes: one standard order on Carrier A, under review.
const planReply = (orderId: string) => ({
  orders: [
    {
      id: orderId,
      priority: "STANDARD",
      ranking: [{ rank: 1, carrier: "A", price: 16.69, score: 0.9, available_at_assignment: true }],
      recommended: "A",
      assigned: "A",
      assigned_price: 16.69,
      capacity_after_assignment: 9,
      same_day: { status: "N/A", appointment_booked: false, commitment_verified: false },
      review: ["REGION_CONFIRM"],
      dispatch_ready: false,
    },
  ],
  capacity: [{ carrier: "A", before_batch: 10, assigned: 1, remaining: 9, order_ids: [orderId] }],
  summary: { total_cost_est: 16.69, review_order_ids: [orderId] },
});

let db: Pool;
let plans: CarrierPlanRepository;
const asked: string[] = [];
const agent: EmailAgent = { ask: async (message) => (asked.push(message), { agent: "carrier", conversationId: "c1", output: "REPORT TEXT" }) };
const service = (withAgent = true) =>
  new CarrierPlanService(plans, new EmailRepository(db), new WarehouseRepository(db), new SettingsRepository(db), withAgent ? agent : undefined, "carrier");

const payload = (state: string, city: string) =>
  JSON.stringify({ placedBy: "C <c@x.test>", customer: null, reference: null, notes: null, products: [{ sku: "S1", quantity: 1 }], address: "1 Main St", suite: null, city, state, postal_code: "60606", country: null });

before(() => {
  const mem = newDb();
  mem.public.none(`
    CREATE TABLE clients (client_id TEXT PRIMARY KEY);
    INSERT INTO clients VALUES ('C001');
    CREATE TABLE warehouses (warehouse_id TEXT PRIMARY KEY, warehouse_name TEXT, region TEXT, pick_list_cutoff TEXT,
      carrier_collection_window TEXT);
    INSERT INTO warehouses VALUES ('W1', 'Midwest 1', 'Midwest', '08:00', '14:00-18:00'), ('W4', 'Northeast Hub', 'Northeast', '08:00', '14:00-18:00');
    CREATE TABLE warehouse_region_distance (warehouse_id TEXT PRIMARY KEY, midwest INT, southeast INT, northeast INT, west INT);
    CREATE TABLE carrier_performance_latest (period_month DATE, carrier_id TEXT, carrier_name TEXT, preferred BOOLEAN,
      midwest_late_pct NUMERIC, northeast_late_pct NUMERIC, southeast_late_pct NUMERIC, west_late_pct NUMERIC,
      avg_rate_usd NUMERIC, deliveries INT);
    INSERT INTO carrier_performance_latest VALUES
      ('2026-10-01', 'A', 'Carrier A', false, 25, 24, 25, 26, 16.69, 100),
      ('2026-10-01', 'F', 'Carrier F', true, 25, 44, 47, 24, 12.52, 100);`);
  for (const f of ["05_inbound_emails", "06_order_requests", "13_ignored_orders", "08_settings", "10_carrier_plans"])
    mem.public.none(readFileSync(new URL(`../../db/init/${f}.sql`, import.meta.url), "utf8"));
  // Routed: an API order in before the cutoff, one from yesterday that never got a carrier, and one after the cutoff,
  // due tomorrow. Not routed, so never on the plan: an API order, and an email that's ready to route.
  const order = (id: string, at: string, edits: string, state: string, city: string) =>
    mem.public.none(`INSERT INTO order_requests (request_id, channel, client_set, client_id, edits, order_payload, created_at)
      VALUES ('${id}', 'api', true, 'C001', '${edits}', '${payload(state, city)}', '${at}')`);
  order("req-00aaaaaa", "2026-10-29T11:00:00Z", '{"routed":{"warehouseIds":["W1"],"at":"2026-10-29T11:05:00Z"}}', "IL", "Chicago");
  order("req-00bbbbbb", "2026-10-29T10:00:00Z", "{}", "Massachusetts", "Boston");
  order("req-00cccccc", "2026-10-29T12:30:00Z", '{"routed":{"warehouseIds":["W4"],"at":"2026-10-29T12:35:00Z"}}', "NY", "Albany");
  order("req-00dddddd", "2026-10-28T11:00:00Z", '{"routed":{"warehouseIds":["W1"],"at":"2026-10-28T11:05:00Z"}}', "IL", "Chicago");
  const email = (id: string, at: string) =>
    mem.public.none(`INSERT INTO inbound_emails (message_id, mailbox, from_address, subject, snippet, received_at)
      VALUES ('${id}', 'in@x.test', 'c@x.test', 'Order', 'Order', '${at}')`);
  email("msg-00eeeeee", "2026-10-29T11:20:00Z");
  mem.public.none(`INSERT INTO order_requests (request_id, channel, message_id, intake_at) VALUES ('msg-00eeeeee', 'email', 'msg-00eeeeee', '2026-10-29T11:21:00Z')`);
  db = new (mem.adapters.createPg().Pool)() as Pool;
  plans = new CarrierPlanRepository(db);
});

describe("carrier plan", () => {
  test("sends every routed order with no carrier, with each carrier's latest figures", async () => {
    const input = await service().input(AFTER_CUTOFF);
    assert.equal(input.planDate, "2026-10-29");
    assert.deepEqual(
      input.orders.map((o) => [o.orderId, o.warehouseName, o.destination, o.region, o.shippingPriority]),
      [
        ["REQ-DDDDDD", "Midwest 1", "Chicago, IL", "Midwest", "High"],
        ["REQ-AAAAAA", "Midwest 1", "Chicago, IL", "Midwest", "Same-day"],
        ["REQ-CCCCCC", "Northeast Hub", "Albany, NY", "Northeast", "Standard"],
      ],
    );
    assert.equal(input.orders[0].dueDate, "2026-10-28");
    const f = input.carriers.find((c) => c.carrierName === "F")!;
    assert.equal(f.preferredSupplier, true);
    assert.deepEqual(f.regionalLateDeliveryRates, { Midwest: 25, Northeast: 44, Southeast: 47, West: 24 });
    assert.equal(f.averageShippingPrice, 12.52);
    assert.equal(f.additionalCapacity, 1, "three orders, so a third of them");
  });

  test("waits for the cutoff, then runs once and keeps the agent's report", async () => {
    await service().tick(BEFORE_CUTOFF);
    assert.equal(asked.length, 0);
    assert.equal(await plans.get("2026-10-29"), null);

    await service().tick(AFTER_CUTOFF);
    assert.equal(asked.length, 1);
    assert.deepEqual(JSON.parse(asked[0]).orders.map((o: { priority: string }) => o.priority), ["HIGH", "SAME_DAY", "STANDARD"]);
    const plan = (await plans.get("2026-10-29"))!;
    assert.equal(plan.report, "REPORT TEXT");
    assert.equal(plan.agent, "carrier");
    assert.equal(plan.run_by, null);

    // Already made today: the next tick doesn't ask again.
    await service().tick(AFTER_CUTOFF);
    assert.equal(asked.length, 1);
  });

  test("without the agent, no plan is made", async () => {
    await service(false).tick(new Date("2026-10-30T13:00:00Z"));
    assert.equal(await plans.get("2026-10-30"), null);
  });

  test("a preview asks the agent about the orders it's given and saves nothing", async () => {
    const before = asked.length;
    const orders = [{ orderId: "SIM-1", warehouseName: "Midwest 1", destination: "Chicago, IL", region: "Midwest", shippingPriority: "Same-day" as const }];
    const result = await service().preview(orders, new Date("2026-10-31T13:00:00Z"));
    assert.equal(asked.length, before + 1);
    assert.deepEqual(JSON.parse(asked[before]).orders, [{ id: "SIM-1", warehouse: "Midwest 1", destination: "Chicago, IL", priority: "SAME_DAY" }]);
    assert.deepEqual(JSON.parse(asked[before]).region_map, { "Chicago, IL": "MIDWEST" });
    const carrier = JSON.parse(asked[before]).carriers[0];
    assert.deepEqual(Object.keys(carrier), ["name", "price", "late_pct", "capacity", "pickup_start", "pickup_cutoff", "same_day_service", "same_day_commitment"]);
    assert.equal(JSON.parse(asked[before]).carriers.length, 2);
    assert.equal(result.report, "REPORT TEXT");
    assert.ok(result.check.errors.length > 0, "the fake's reply is not a plan, so the validator objects");
    assert.equal(await plans.get("2026-10-31"), null);
    await assert.rejects(service(false).preview(orders), /not configured/);
  });

  test("staff change a carrier on a finished plan, and a re-run keeps it from the agent's reply", async () => {
    const date = "2026-10-29";
    const inputOf = async () => (await plans.get(date))!.input as PlanInput;
    assert.equal(await service().choose("REQ-AAAAAA", "F", "staff-1", AFTER_CUTOFF), date);
    assert.deepEqual((await inputOf()).overrides, { "REQ-AAAAAA": { carrier: "F", by: "staff-1", at: AFTER_CUTOFF.toISOString() } });
    assert.equal((await plans.get(date))!.report, "REPORT TEXT");

    const before = asked.length;
    await service().run("00000000-0000-0000-0000-000000000002", AFTER_CUTOFF);
    assert.equal((await inputOf()).overrides!["REQ-AAAAAA"].carrier, "F");
    assert.equal(asked.length, before + 1);
    assert.equal(JSON.parse(asked[before]).overrides, undefined);
    assert.ok(!asked[before].includes("staff-1"), "the agent isn't told");

    await service().choose("REQ-AAAAAA", null, "staff-1", AFTER_CUTOFF);
    assert.deepEqual((await inputOf()).overrides, {});
  });

  test("a carrier can only be changed to a known carrier, on an order on today's plan", async () => {
    await assert.rejects(service().choose("REQ-AAAAAA", "Z", "staff-1", AFTER_CUTOFF), { status: 400 });
    await assert.rejects(service().choose("REQ-NOPE", "F", "staff-1", AFTER_CUTOFF), { status: 404 });
    await assert.rejects(service().choose("__proto__", "F", "staff-1", AFTER_CUTOFF), { status: 404 });
    await assert.rejects(service().choose("REQ-AAAAAA", "F", "staff-1", new Date("2026-10-30T13:00:00Z")), { status: 404 });
  });

  test("from a plan that failed validation, Assign takes only staff's picks and leaves the rest for the next plan", async () => {
    await service().choose("REQ-AAAAAA", "F", "staff-1", AFTER_CUTOFF);
    const result = await service().assign(STAFF, false, AFTER_CUTOFF, () => 0.5);
    assert.deepEqual(result.assigned, ["REQ-AAAAAA"]);
    assert.deepEqual(result.skipped, [
      { orderId: "REQ-DDDDDD", reason: "no carrier" },
      { orderId: "REQ-CCCCCC", reason: "no carrier" },
    ]);

    const [row] = await new EmailRepository(db).assignments(["req-00aaaaaa"]);
    assert.equal(row.assigned_carrier, "F");
    const hours = (new Date(row.delivered_at!).getTime() - AFTER_CUTOFF.getTime()) / 3_600_000;
    assert.equal(hours, 4.5);
  });

  test("an assigned order is locked, leaves the next plan, and is delivered once its time has passed", async () => {
    await assert.rejects(service().choose("REQ-AAAAAA", "A", "staff-1", AFTER_CUTOFF), { status: 409 });
    assert.deepEqual((await service().assign(STAFF, false, AFTER_CUTOFF)).assigned, []);
    const next = await service().input(AFTER_CUTOFF);
    assert.ok(!next.orders.some((o) => o.orderId === "REQ-AAAAAA"));

    const plan = (await plans.get("2026-10-29"))!.input as PlanInput;
    assert.equal((await service().assignments(plan))["REQ-AAAAAA"].carrier, "F");
    const [row] = await new EmailRepository(db).assignments(["req-00aaaaaa"]);
    assert.equal(assignmentOf(row, new Date("2026-10-29T17:29:00Z"))!.delivered, false);
    assert.equal(assignmentOf(row, new Date("2026-10-29T17:30:00Z"))!.delivered, true);
  });

  test("from a valid plan, Assign takes the agent's carrier, under review or not", async () => {
    const orderId = "REQ-CCCCCC";
    const report = planReply(orderId);
    const carriers = (await service().input(AFTER_CUTOFF)).carriers.map((c) => ({ ...c, additionalCapacity: 10 }));
    const order = { orderId, requestId: "req-00cccccc", warehouseName: "Northeast Hub", destination: "Albany, NY", region: "Northeast", shippingPriority: "Standard" as const };
    const input: PlanInput = { planDate: "2026-10-30", orders: [order], carriers };
    await plans.save({ date: "2026-10-30", input, report: JSON.stringify(report), agent: "carrier", runBy: null });

    const result = await service().assign(STAFF, false, new Date("2026-10-30T13:00:00Z"), () => 0);
    assert.deepEqual(result, { date: "2026-10-30", assigned: [orderId], skipped: [] });
    assert.deepEqual(await service().waiting(input.orders, new Date("2026-10-30T13:00:00Z")), ["REQ-DDDDDD"]);
  });

  test("from a failed plan, the agent's carriers are only assigned on an override", async () => {
    const now = new Date("2026-10-31T13:00:00Z");
    const orderId = "REQ-DDDDDD";
    const carriers = (await service().input(now)).carriers;
    const order = { orderId, requestId: "req-00dddddd", warehouseName: "Midwest 1", destination: "Chicago, IL", region: "Midwest", shippingPriority: "High" as const };
    const report = { ...planReply(orderId), summary: { total_cost_est: 1, review_order_ids: [orderId] } };
    await plans.save({ date: "2026-10-31", input: { planDate: "2026-10-31", orders: [order], carriers }, report: JSON.stringify(report), agent: "carrier", runBy: null });

    assert.deepEqual((await service().assign(STAFF, false, now)).skipped, [{ orderId, reason: "no carrier" }]);
    assert.deepEqual((await service().assign(STAFF, true, now)).assigned, [orderId]);
    assert.equal((await new EmailRepository(db).assignments(["req-00dddddd"]))[0].assigned_carrier, "A");
  });

  test("the API allocates from the agent's ranking: invented orders go, and each order takes its top carrier", async () => {
    const ranked = (id: string, assigned: string | null, review: string[]) => ({
      id,
      priority: "STANDARD",
      ranking: [
        { carrier: "F", price: 12.52, score: 85, reliability: 75.26, available_at_assignment: null },
        { carrier: "A", price: 16.69, score: 75, reliability: 75.02, available_at_assignment: null },
      ],
      recommended: "F",
      assigned,
      assigned_price: assigned === "A" ? 16.69 : null,
      same_day: { status: "N/A", appointment_booked: false, commitment_verified: false },
      review,
      dispatch_ready: false,
    });
    const output = {
      orders: [ranked("REQ-X", null, ["CAPACITY_UNKNOWN"]), ranked("REQ-Y", "A", ["CAPACITY_UNKNOWN"]), ranked("REQ-X_DUP", null, ["CAPACITY_UNKNOWN"])],
      capacity: [],
      summary: { total_cost_est: 0, review_order_ids: [], missing_data: [{ carrier: "A", fields: ["capacity"] }] },
    };
    const agent: EmailAgent = { ask: async () => ({ agent: "carrier", conversationId: "c4", output }) };
    const order = { warehouseName: "Midwest 1", destination: "Chicago, IL", region: "Midwest", shippingPriority: "Standard" as const };
    const orders = [{ ...order, orderId: "REQ-X" }, { ...order, orderId: "REQ-Y" }];
    const result = await new CarrierPlanService(plans, new EmailRepository(db), new WarehouseRepository(db), new SettingsRepository(db), agent, "carrier").preview(orders, AFTER_CUTOFF);

    assert.deepEqual(result.check.errors, []);
    const plan = JSON.parse(result.report);
    assert.deepEqual(plan.orders.map((o: { id: string; assigned: string; assigned_price: number }) => [o.id, o.assigned, o.assigned_price]), [["REQ-X", "F", 12.52], ["REQ-Y", "A", 16.69]]);
    assert.equal(plan.orders[0].risk, "HIGH");
    assert.equal(plan.summary.total_cost_est, 29.21);
    assert.deepEqual(plan.capacity.find((c: { carrier: string }) => c.carrier === "F").order_ids, ["REQ-X"]);
    assert.deepEqual(result.check.dispatch, ["REQ-X"]);
    assert.deepEqual(plan.summary.missing_data, []);
  });

  test("each carrier takes a third of the plan's orders, then orders go to the next with room, flagged", async () => {
    const orders = Array.from({ length: 6 }, (_, i) => ({ orderId: `REQ-${i}`, warehouseName: "Midwest 1", destination: "Chicago, IL", region: "Midwest", shippingPriority: "Standard" as const }));
    const output = {
      orders: orders.map((o) => ({
        id: o.orderId,
        priority: "STANDARD",
        ranking: [
          { carrier: "F", price: 12.52, score: 85, reliability: 75.26 },
          { carrier: "A", price: 16.69, score: 75, reliability: 75.02 },
        ],
        same_day: { status: "N/A", appointment_booked: false, commitment_verified: false },
        review: [],
      })),
      summary: {},
    };
    const agent: EmailAgent = { ask: async () => ({ agent: "carrier", conversationId: "c5", output }) };
    const result = await new CarrierPlanService(plans, new EmailRepository(db), new WarehouseRepository(db), new SettingsRepository(db), agent, "carrier").preview(orders, AFTER_CUTOFF);

    assert.deepEqual(result.check.errors, []);
    const plan = JSON.parse(result.report);
    assert.deepEqual(plan.orders.map((o: { assigned: string | null }) => o.assigned), ["F", "F", "A", "A", null, null]);
    assert.deepEqual(plan.orders[2].review, ["CAPACITY_REASSIGNED"]);
    assert.deepEqual(plan.orders[4].review, ["NO_CARRIER_WITH_ROOM"]);
    const f = plan.capacity.find((c: { carrier: string }) => c.carrier === "F");
    assert.deepEqual([f.before_batch, f.assigned, f.remaining, f.status], [2, 2, 0, "FULL"]);
  });

  test("capacity under the agent's other field names is read as the same fields", async () => {
    const reply = planReply("REQ-X");
    const renamed = { ...reply, capacity: [{ carrier: "A", assigned_orders: 1, starting_capacity: null, remaining_capacity: null, order_ids: ["REQ-X"] }] };
    const agent: EmailAgent = { ask: async () => ({ agent: "carrier", conversationId: "c3", output: renamed }) };
    const orders = [{ orderId: "REQ-X", warehouseName: "Midwest 1", destination: "Chicago, IL", region: "Midwest", shippingPriority: "Standard" as const }];
    const result = await new CarrierPlanService(plans, new EmailRepository(db), new WarehouseRepository(db), new SettingsRepository(db), agent, "carrier").preview(orders, AFTER_CUTOFF);
    assert.deepEqual(result.check.errors, []);
    assert.equal(JSON.parse(result.report).capacity[0].before_batch, 1);
  });

  test("an order the agent wrote out twice is dropped, but one that differs is still refused", async () => {
    const orders = [{ orderId: "REQ-X", warehouseName: "Midwest 1", destination: "Chicago, IL", region: "Midwest", shippingPriority: "Standard" as const }];
    const replying = (reply: ReturnType<typeof planReply>) =>
      new CarrierPlanService(plans, new EmailRepository(db), new WarehouseRepository(db), new SettingsRepository(db), {
        ask: async () => ({ agent: "carrier", conversationId: "c2", output: reply }),
      }, "carrier");

    const reply = planReply("REQ-X");
    const twice = await replying({ ...reply, orders: [reply.orders[0], reply.orders[0]] }).preview(orders, AFTER_CUTOFF);
    assert.equal(JSON.parse(twice.report).orders.length, 1);
    assert.deepEqual(twice.check.errors, []);

    const differs = { ...reply.orders[0], assigned_price: 1 };
    const refused = await replying({ ...reply, orders: [reply.orders[0], differs] }).preview(orders, AFTER_CUTOFF);
    assert.equal(JSON.parse(refused.report).orders.length, 2);
    assert.ok(refused.check.errors.includes("orders missing or duplicated"));
  });
});
