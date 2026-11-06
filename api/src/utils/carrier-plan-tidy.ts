// The carrier agent ranks well, but what it builds on the ranking changes from run to run: orders repeated or invented,
// none assigned, orders moved off their top carrier for no reason, capacity fields renamed. So the API takes the ranking
// and does the allocation here, before the validator sees the reply: same-day, then high, then standard, then by id,
// each order on its best-ranked carrier with room. An unknown capacity counts as room.
import { jsonOf } from "./agent-json.js";

const SEQUENCE: Record<string, number> = { SAME_DAY: 0, HIGH: 1, STANDARD: 2 };
const byId = (a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// The risk bands in the agent's instructions.
const riskOf = (onTime: number) => (onTime >= 95 ? "LOW" : onTime >= 85 ? "MODERATE" : "HIGH");
// A row's on-time figure: the agent calls it reliability on some runs and gives late_pct on others.
const onTimeOf = (row: any) => (typeof row.reliability === "number" ? row.reliability : typeof row.late_pct === "number" ? 100 - row.late_pct : null);

// carriers: as the agent was sent them, with additionalCapacity null when unknown. orderIds: the orders it was sent.
export function tidyReply(report: string, orderIds: string[], carriers: { carrierName: string; additionalCapacity: number | null }[]) {
  const reply = jsonOf(report) as any;
  if (!Array.isArray(reply?.orders)) return report;
  // An exact repeat is dropped; a repeat that differs stays, for the validator to refuse.
  const sent: any[] = [...new Map(reply.orders.map((o: any) => [JSON.stringify(o), o])).values()].filter((o: any) => orderIds.includes(o?.id));

  const start = Object.fromEntries(carriers.map((c) => [c.carrierName, c.additionalCapacity]));
  const known = carriers.every((c) => c.additionalCapacity !== null);
  const left = { ...start };
  const allocated = new Map<any, any>();
  for (const o of [...sent].sort((a, b) => (SEQUENCE[a.priority] ?? 3) - (SEQUENCE[b.priority] ?? 3) || byId(a, b))) {
    const rows: any[] = Array.isArray(o.ranking) ? o.ranking : [];
    if (!rows.length || !rows.every((r) => r?.carrier)) {
      allocated.set(o, o);
      continue;
    }
    const room = (carrier: string) => (left[carrier] === null || left[carrier] === undefined ? null : left[carrier]! > 0);
    const ranking = rows.map((r) => ({ ...r, available_at_assignment: room(r.carrier) }));
    const pick = ranking.find((r) => r.available_at_assignment !== false);
    const moved = pick && pick.carrier !== rows[0].carrier;
    if (pick && typeof left[pick.carrier] === "number") left[pick.carrier]!--;
    const stale = ["CAPACITY_REASSIGNED", ...(known ? ["CAPACITY_UNKNOWN", "MISSING_DATA"] : [])];
    const review = (Array.isArray(o.review) ? o.review : []).filter((code: unknown) => !stale.includes(code as string));
    if (moved) review.push("CAPACITY_REASSIGNED");
    if (!pick) review.push("NO_CARRIER_WITH_ROOM");
    const onTime = pick ? onTimeOf(pick) : null;
    const assigned = pick?.carrier ?? null;
    allocated.set(o, {
      ...o,
      ranking,
      recommended: rows[0].carrier,
      assigned,
      assigned_price: pick?.price ?? null,
      capacity_after_assignment: pick ? (left[pick.carrier] ?? null) : null,
      on_time_baseline_pct: onTime,
      risk: onTime === null ? "UNKNOWN" : riskOf(onTime),
      reason: o.reason ?? (moved ? `${rows[0].carrier} ranked first but was full.` : "Best-ranked carrier with room."),
      review,
      dispatch_ready: !review.length && assigned !== null && (o.priority !== "SAME_DAY" || o.same_day?.status === "CONFIRMED"),
    });
  }

  const orders = sent.map((o) => allocated.get(o));
  const total = orders.reduce((sum, o) => sum + (o.assigned && typeof o.assigned_price === "number" ? o.assigned_price : 0), 0);
  const tidied = {
    ...reply,
    orders,
    capacity: carriers.map(({ carrierName }) => {
      const ids = orders.filter((o) => o.assigned === carrierName).map((o) => o.id);
      const before = start[carrierName];
      const remaining = before === null ? null : before - ids.length;
      return { carrier: carrierName, before_batch: before, assigned: ids.length, remaining, status: remaining === null ? "UNKNOWN" : remaining > 0 ? "AVAILABLE" : "FULL", order_ids: ids };
    }),
    summary: {
      ...reply.summary,
      total_cost_est: Math.round(total * 100) / 100,
      review_order_ids: orders.filter((o) => Array.isArray(o.review) && o.review.length).map((o) => o.id),
      missing_data: (Array.isArray(reply.summary?.missing_data) ? reply.summary.missing_data : []).filter((m: unknown) => !known || !/capacity/i.test(JSON.stringify(m))),
    },
  };
  return JSON.stringify(tidied) === JSON.stringify(reply) ? report : JSON.stringify(tidied, null, 2);
}
