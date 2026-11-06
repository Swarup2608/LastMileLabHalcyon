// The carrier plan validator: a consistent plan passes and clears only its dispatch-ready orders; any error, or a reply
// that isn't the plan's shape, clears nothing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, validate } from "../src/utils/carrier-plan-validate.js";

const N_A = { status: "N/A", earliest_pickup: null, same_day_cutoff: null, commitment_verified: false, appointment_booked: false };
const rank = (r: number, carrier: string, price: number, score: number, available: boolean | null) =>
  ({ rank: r, carrier, price, late_pct: 0, score, tie_break: null, available_at_assignment: available });

// The example plan from the carrier agent's instructions.
const plan = () => ({
  status: "OK",
  orders: [
    {
      id: "HAL-9001", priority: "STANDARD",
      ranking: [rank(1, "E", 12.5, 88.0, true), rank(2, "Fpreferred", 14.0, 85.2, false)],
      recommended: "E", assigned: "E", assigned_price: 12.5, capacity_after_assignment: 28,
      same_day: N_A, review: [], dispatch_ready: true,
    },
    {
      id: "HAL-9002", priority: "HIGH",
      ranking: [rank(1, "Fpreferred", 14.0, 88.3, false), rank(2, "E", 12.5, 85.6, true)],
      recommended: "Fpreferred", assigned: "E", assigned_price: 12.5, capacity_after_assignment: 29,
      same_day: N_A, review: ["REGION_CONFIRM", "CAPACITY_REASSIGNED"], dispatch_ready: false,
    },
    {
      id: "HAL-9003", priority: "SAME_DAY",
      ranking: [rank(1, "Fpreferred", 14.0, 88.3, true), rank(2, "E", 12.5, 85.6, true)],
      recommended: "Fpreferred", assigned: "Fpreferred", assigned_price: 14.0, capacity_after_assignment: 0,
      same_day: { status: "PENDING_CONFIRMATION", earliest_pickup: "10:00", same_day_cutoff: "11:00", commitment_verified: false, appointment_booked: false },
      review: ["SAME_DAY_UNCONFIRMED"], dispatch_ready: false,
    },
  ],
  capacity: [
    { carrier: "E", before_batch: 30, assigned: 2, remaining: 28, status: "AVAILABLE", order_ids: ["HAL-9001", "HAL-9002"] },
    { carrier: "Fpreferred", before_batch: 1, assigned: 1, remaining: 0, status: "FULL", order_ids: ["HAL-9003"] },
  ],
  pickup_groups: [],
  summary: { total_cost_est: 39.0, review_order_ids: ["HAL-9002", "HAL-9003"], missing_data: [] },
});
const cap = { E: 30, Fpreferred: 1 };
const ids = ["HAL-9001", "HAL-9002", "HAL-9003"];

describe("carrier plan validator", () => {
  test("passes the example plan and clears only its dispatch-ready order", () => {
    assert.deepEqual(validate(plan(), cap, ids), []);
    assert.deepEqual(checkPlan("```json\n" + JSON.stringify(plan()) + "\n```", cap, ids), { errors: [], dispatch: ["HAL-9001"] });
  });

  test("any error clears nothing, even orders marked ready", () => {
    const p = plan();
    p.summary.total_cost_est = 40;
    p.orders[1].review = ["REGION_CONFIRM"];
    const { errors, dispatch } = checkPlan(JSON.stringify(p), cap, ids);
    assert.deepEqual(errors, ["HAL-9002: reassignment not flagged", "total cost 40 != 39"]);
    assert.deepEqual(dispatch, []);
  });

  test("replays allocation: availability and capacity left must follow the same-day, high, standard order", () => {
    const p = plan();
    p.orders[0].ranking[1].available_at_assignment = true;
    p.orders[2].capacity_after_assignment = 1;
    assert.deepEqual(validate(p, cap, ids), ["HAL-9003: capacity_after_assignment wrong", "HAL-9001: Fpreferred availability wrong"]);
  });

  test("with capacity unknown, availability must be null and capacity isn't reconciled", () => {
    const p = plan();
    for (const o of p.orders) for (const r of o.ranking) r.available_at_assignment = null;
    for (const o of p.orders) (o as { capacity_after_assignment: number | null }).capacity_after_assignment = null;
    assert.deepEqual(validate(p, { E: null, Fpreferred: null }, ids), []);
  });

  test("missing or extra orders fail", () => {
    assert.deepEqual(validate(plan(), cap, ["HAL-9001", "HAL-9002"]), ["orders missing or duplicated"]);
  });

  test("a reply that isn't the plan's shape fails as one error", () => {
    assert.deepEqual(checkPlan("A. Order ID: REQ-1 …", cap, ids), { errors: ["reply is not JSON"], dispatch: [] });
    const p = plan() as { orders: unknown[] };
    delete (p.orders[0] as { same_day?: unknown }).same_day;
    assert.deepEqual(checkPlan(JSON.stringify(p), cap, ids), { errors: ['reply not in the expected shape: missing "same_day"'], dispatch: [] });
  });
});
