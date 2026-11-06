// Checks the carrier agent's JSON plan before anything in it is dispatched. validate() is a line-for-line port of the
// validator in the agent's instructions (Python) and must stay in step with it: same checks, same messages, and the
// same failures on a malformed reply (a missing key or a wrong type throws, as Python's KeyError or TypeError would).
import { jsonOf } from "./agent-json.js";

class ShapeError extends Error {}

// Python's o["key"]: throws when the key is missing or o isn't a dict.
const at = (o: any, key: string): any => {
  if (o === null || typeof o !== "object" || Array.isArray(o) || !(key in o)) throw new ShapeError(`missing "${key}"`);
  return o[key];
};
// Python's truthiness: None, False, 0, "", [] and {} are false.
const truthy = (v: unknown) =>
  !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length) ||
    (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length));
const list = (v: any): any[] => {
  if (!Array.isArray(v)) throw new ShapeError("expected a list");
  return v;
};
const num = (v: any): number => {
  if (typeof v !== "number") throw new ShapeError(`expected a number, got ${JSON.stringify(v)}`);
  return v;
};
// Python's list ==, for lists of scalars.
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
// Python's sorted() on strings: by code point.
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs: string[]) => [...xs].sort(byCodePoint);

// r: the agent's plan. cap: each carrier's capacity before the batch ({"E": 30, ...}; null when unknown). inputIds: the
// order ids the agent was sent. Returns the errors; empty means the plan is consistent.
export function validate(r: any, cap: Record<string, number | null>, inputIds: string[]): string[] {
  const errs: string[] = [];
  const used: Record<string, number> = {};
  const orders = list(at(r, "orders"));
  for (const o of orders) {
    const i = at(o, "id");
    const rk = list(at(o, "ranking"));
    const sd = at(o, "same_day");
    const scores = rk.map((x) => num(at(x, "score")));
    if (!same(scores, [...scores].sort((a, b) => b - a))) errs.push(`${i}: ranking not sorted`);
    if (rk.length && at(o, "recommended") !== at(rk[0], "carrier")) errs.push(`${i}: recommended != rank 1`);
    if (truthy(at(o, "assigned"))) {
      const assigned = at(o, "assigned");
      used[assigned] = (used[assigned] ?? 0) + 1;
      const row = rk.find((x) => at(x, "carrier") === assigned);
      if (!row || at(row, "price") !== at(o, "assigned_price")) errs.push(`${i}: assigned price mismatch`);
      if (assigned !== at(o, "recommended") && !list(at(o, "review")).includes("CAPACITY_REASSIGNED"))
        errs.push(`${i}: reassignment not flagged`);
    }
    if (at(o, "priority") !== "SAME_DAY" && at(sd, "status") !== "N/A") errs.push(`${i}: non-same-day order has same-day status`);
    if (at(sd, "status") === "PENDING_CONFIRMATION" && !list(at(o, "review")).includes("SAME_DAY_UNCONFIRMED"))
      errs.push(`${i}: pending same-day not under review`);
    if (truthy(at(sd, "appointment_booked")) || (at(sd, "status") === "CONFIRMED" && !truthy(at(sd, "commitment_verified"))))
      errs.push(`${i}: same-day confirmation invalid`);
    const ready =
      !truthy(at(o, "review")) && at(o, "assigned") !== null && (at(o, "priority") !== "SAME_DAY" || at(sd, "status") === "CONFIRMED");
    if (at(o, "dispatch_ready") !== ready) errs.push(`${i}: dispatch_ready wrong`);
  }

  // Every order exactly once
  const ids: string[] = orders.map((o) => at(o, "id"));
  if (!same(sorted(ids), sorted(inputIds)) || ids.length !== new Set(ids).size) errs.push("orders missing or duplicated");
  const capacity = list(at(r, "capacity"));
  const listed = capacity.flatMap((c) => list(at(c, "order_ids")));
  if (listed.length !== new Set(listed).size) errs.push("order listed under more than one carrier");

  // Capacity reconciliation
  for (const c of capacity) {
    const carrier = at(c, "carrier");
    const n = used[carrier] ?? 0;
    const start = cap[carrier] ?? null;
    if (at(c, "assigned") !== n) errs.push(`${carrier}: assigned ${at(c, "assigned")} != actual ${n}`);
    if (start !== null && (n > start || at(c, "before_batch") !== start || at(c, "remaining") !== start - n))
      errs.push(`${carrier}: capacity mismatch`);
  }

  // Replay allocation sequence
  const seq: Record<string, number> = { SAME_DAY: 0, HIGH: 1, STANDARD: 2 };
  const order = (o: any) => {
    const p = at(o, "priority");
    if (!(p in seq)) throw new ShapeError(`unknown priority ${JSON.stringify(p)}`);
    return seq[p];
  };
  const rem: Record<string, number | null> = { ...cap };
  for (const o of [...orders].sort((a, b) => order(a) - order(b) || byCodePoint(at(a, "id"), at(b, "id")))) {
    for (const row of list(at(o, "ranking"))) {
      const c = at(row, "carrier");
      const exp = rem[c] === null || rem[c] === undefined ? null : rem[c]! > 0;
      if (at(row, "available_at_assignment") !== exp) errs.push(`${at(o, "id")}: ${c} availability wrong`);
    }
    const a = at(o, "assigned");
    if (truthy(a) && rem[a] !== null && rem[a] !== undefined) {
      rem[a] = rem[a]! - 1;
      if (at(o, "capacity_after_assignment") !== rem[a]) errs.push(`${at(o, "id")}: capacity_after_assignment wrong`);
    }
  }

  // Cost and review list
  const total = orders.filter((o) => truthy(at(o, "assigned"))).reduce((s, o) => s + num(at(o, "assigned_price")), 0);
  const cost = Math.round(total * 100) / 100;
  const summary = at(r, "summary");
  if (Math.abs(cost - num(at(summary, "total_cost_est"))) > 0.005) errs.push(`total cost ${at(summary, "total_cost_est")} != ${cost}`);
  if (!same(sorted(orders.filter((o) => truthy(at(o, "review"))).map((o) => at(o, "id"))), sorted(list(at(summary, "review_order_ids")))))
    errs.push("review_order_ids mismatch");
  return errs;
}

export interface PlanCheck {
  // Empty: the plan passed and its dispatch-ready orders can go.
  errors: string[];
  // Orders that may be dispatched: dispatch_ready ones, and only from a plan with no errors.
  dispatch: string[];
}

// Runs validate() on the agent's reply. cap: each carrier's capacity before the batch, as the agent was given it.
// A reply that isn't JSON or isn't the plan's shape fails as one error, so nothing in it is dispatched.
export function checkPlan(report: string, cap: Record<string, number | null>, inputIds: string[]): PlanCheck {
  const r = jsonOf(report) as any;
  if (!r || typeof r !== "object") return { errors: ["reply is not JSON"], dispatch: [] };
  let errors: string[];
  try {
    errors = validate(r, cap, inputIds);
  } catch (err) {
    return { errors: [`reply not in the expected shape: ${err instanceof Error ? err.message : String(err)}`], dispatch: [] };
  }
  const dispatch = errors.length ? [] : (r.orders as any[]).filter((o) => o.dispatch_ready === true).map((o) => String(o.id));
  return { errors, dispatch };
}
