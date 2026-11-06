"use client";

import { Fragment, useEffect, useState } from "react";
import toast from "react-hot-toast";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";
import {
  carrierPlanApi,
  parseReport,
  words,
  withChoices,
  type AgentPlan,
  type CarrierPlanState,
  type PlanCall,
  type PlanCarrier,
  type PlanRegion,
} from "@/lib/carrier-plan";
import { jsonOf } from "@/lib/emails";
import { deliveryDay } from "@/lib/settings";

const REGIONS: PlanRegion[] = ["Midwest", "Northeast", "Southeast", "West"];
// Above this a lane reads as a bad one, as on the carrier slide.
const BAD_LATE_ABOVE = 40;
const RISK_CHIP: Record<string, string> = { low: "ok", moderate: "warn", high: "bad" };
// The agent's review codes; any other shows as its words.
const REVIEW: Record<string, string> = {
  REGION_CONFIRM: "confirm region",
  CAPACITY_REASSIGNED: "first choice full",
  SAME_DAY_UNCONFIRMED: "same-day not confirmed",
  CAPACITY_UNKNOWN: "capacity unknown",
  MISSING_DATA: "carrier data missing",
  NO_CARRIER_WITH_ROOM: "no carrier has room",
};
const STATUS_CHIP: Record<string, string> = { AVAILABLE: "ok", CONFIRMED: "ok", FULL: "warn", PENDING_CONFIRMATION: "warn", UNAVAILABLE: "bad" };
const statusChip = (status: string) => <span className={`chip ${STATUS_CHIP[status] ?? ""}`}>{words(status)}</span>;
const reviewLabel = (code: string) => REVIEW[code] ?? words(code).toLowerCase();

const time = (at: string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const money = (n: number | null) => (n === null ? "–" : `$${n.toFixed(2)}`);
const H3: React.CSSProperties = { margin: 0, fontSize: 18, lineHeight: "26px" };
const SUB: React.CSSProperties = { margin: "4px 0 16px", fontSize: 14 };

// The Orders page's Carrier plan tab (staff). Same-day orders are taken until the admin's cutoff; after it they're
// final and the API sends them, with any overdue order still missing a carrier, to the carrier agent, which ranks the
// carriers for each order on price and regional
// late-delivery rate and assigns each to the best one with capacity, replying in JSON. Here: its assignment per order
// as a table (a row opens the full ranking), carrier capacity and pickups, the carrier figures it was given, and its
// reply as written. Staff can run it again, e.g. after routing an order that was waiting, and can change any order's
// carrier, even once it's cleared; a re-run keeps what they picked. Assign, at the end, locks the carriers in.
export default function CarrierPlan() {
  const [state, setState] = useState<CarrierPlanState | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // The order whose carrier is being saved.
  const [choosing, setChoosing] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      carrierPlanApi.get().then(
        (s) => active && (setState(s), setFailed(false)),
        () => active && setFailed(true),
      );
    load();
    // Picks up the plan the API makes at the cutoff without a reload.
    const timer = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function run() {
    setRunning(true);
    try {
      const { plan } = await carrierPlanApi.run();
      // Everything waiting went into this run.
      setState((s) => s && { ...s, plan, waiting: [] });
      toast.success(plan.report ? `Carrier plan updated for ${plan.input.orders.length} orders` : "No orders are waiting for a carrier");
    } catch (err) {
      toast.error(err instanceof ApiError ? `The carrier agent couldn’t run: ${err.message}` : "We couldn’t reach Halcyon.");
    } finally {
      setRunning(false);
    }
  }

  async function assign() {
    setAssigning(true);
    try {
      const { plan, assigned, skipped } = await carrierPlanApi.assign(rejected.length > 0);
      setState((s) => s && { ...s, plan });
      toast.success(`${assigned} ${assigned === 1 ? "order" : "orders"} assigned${skipped.length ? `, ${skipped.length} left for the next plan` : ""}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? `The orders weren’t assigned: ${err.message}` : "We couldn’t reach Halcyon.");
    } finally {
      setAssigning(false);
    }
  }

  // Picking the agent's own carrier takes the staff choice off.
  async function choose(call: PlanCall, carrier: string) {
    setChoosing(call.id);
    try {
      const { plan } = await carrierPlanApi.choose(call.id, !carrier || carrier === call.agent_assigned ? null : carrier);
      setState((s) => s && { ...s, plan });
      toast.success(carrier ? `${call.id} now goes with Carrier ${carrier}` : `${call.id} has no carrier`);
    } catch (err) {
      toast.error(err instanceof ApiError ? `The carrier didn’t change: ${err.message}` : "We couldn’t reach Halcyon.");
    } finally {
      setChoosing(null);
    }
  }

  if (failed) return <div className="card empty" role="alert">We couldn’t load the carrier plan from Halcyon.</div>;
  if (!state) return <div className="card empty" aria-busy="true">Loading the carrier plan…</div>;

  const plan = state.plan;
  const message = !state.enabled
    ? "The carrier agent isn’t set up. Set FOUNDRY_CARRIER_AGENT_NAME on the API to get carrier recommendations after the cutoff."
    : !state.cutoffPassed
      ? `Same-day orders are still coming in until ${state.cutoff} (${state.timeZone}). Once the cutoff passes they’re final and the carrier agent recommends a carrier for each.`
      : !plan
        ? "The cutoff has passed; the carrier agent is working on the orders waiting for a carrier."
        : !plan.report && !state.waiting.length
          ? "No orders are waiting for a carrier, so there’s nothing to plan."
          : null;

  const agentPlan = plan?.report ? parseReport(plan.report) : null;
  const parsed = plan && agentPlan ? withChoices(agentPlan, plan.input) : null;
  const calls = parsed?.orders ?? [];
  const orders = plan?.input.orders ?? [];
  const regionsToday = new Set(orders.map((o) => o.region).filter(Boolean));
  // Cleared by the API's validator, not just marked ready by the agent.
  const cleared = new Set(plan?.check?.dispatch ?? []);
  const rejected = [...new Set(plan?.check?.errors ?? [])];
  const assignments = plan?.assignments ?? {};
  const shipsFrom = (c: PlanCall) => c.warehouse ?? orders.find((o) => o.orderId === c.id)?.warehouseName;
  const ready = calls.filter((c) => !assignments[c.id] && c.assigned && shipsFrom(c));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 24 }}>
      <section className="card" style={{ padding: "20px 24px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {deliveryDay(state.today)} · same-day cutoff {state.cutoff}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 32, lineHeight: "40px", fontWeight: 700 }}>
            {plan ? orders.length : state.waiting.length}
            <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 12 }}>
              {(plan ? orders.length : state.waiting.length) === 1 ? "order" : "orders"} {plan ? `planned at ${time(plan.createdAt)}` : "waiting for a carrier"}
            </span>
          </p>
        </div>
        {parsed && (
          <div style={{ display: "flex", gap: 24 }}>
            <Stat label="Cleared to dispatch" value={`${cleared.size} of ${calls.length}`} />
            <Stat label="Est. carrier cost" value={money(parsed.summary.total_cost_est)} />
          </div>
        )}
        {state.enabled && (
          <button className="btn btn-secondary" type="button" disabled={running} aria-busy={running} onClick={run}>
            {running && <Spinner />}
            {running ? "Running…" : plan ? "Run again" : "Run now"}
          </button>
        )}
      </section>

      {message && <div className="card empty">{message}</div>}

      {state.enabled && state.waiting.length > 0 && (
        <div className="card" role="status" style={{ padding: "12px 16px", fontSize: 14 }}>
          <b>
            {state.waiting.length} {state.waiting.length === 1 ? "order isn’t" : "orders aren’t"} on this plan yet.
          </b>{" "}
          {plan ? "Run again" : "Run now"} to bring {state.waiting.length === 1 ? "it" : "them"} in:{" "}
          <span className="mono" style={{ fontSize: 12 }}>{state.waiting.join(", ")}</span>
        </div>
      )}

      {plan?.report && (
        <section className="card" style={{ padding: "20px 24px" }} aria-label="Carrier per order">
          <h3 style={H3}>Carrier per order</h3>
          <p className="muted" style={SUB}>
            Every routed order with no carrier yet, overdue ones included. Change a carrier here at any time until it’s assigned, even once an order is cleared. Open a row for the agent’s full ranking. On time is 100% minus the carrier’s historical
            late rate into the region, not a prediction.
          </p>
          {rejected.length > 0 && (
            <div className="card" role="alert" style={{ padding: "12px 16px", marginBottom: 16, background: "var(--bad-soft)", color: "var(--bad)", fontSize: 13 }}>
              <b>The plan failed validation, so none of its orders is cleared to dispatch.</b> Run it again once the agent’s reply is fixed.
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {rejected.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {parsed ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Ships from</th>
                    <th>Destination</th>
                    <th>Carrier</th>
                    <th className="num">On time</th>
                    <th className="num">Price</th>
                    <th>Risk</th>
                    <th>Dispatch</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => {
                    const o = orders.find((x) => x.orderId === c.id);
                    const warehouse = shipsFrom(c);
                    const assignment = assignments[c.id];
                    const region = c.region ?? o?.region;
                    const sameDay = c.same_day && c.same_day.status !== "N/A" ? c.same_day : null;
                    const expanded = open === c.id;
                    return (
                      <Fragment key={c.id}>
                        <tr
                          tabIndex={0}
                          aria-expanded={expanded}
                          style={{ cursor: "pointer" }}
                          onClick={() => setOpen(expanded ? null : c.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(expanded ? null : c.id))}
                        >
                          <td className="mono">
                            {c.id}
                            {o?.shippingPriority === "High" && (
                              <span className="sub">
                                <span className="chip warn">Overdue</span>
                                {o.dueDate && ` due ${deliveryDay(o.dueDate)}`}
                              </span>
                            )}
                          </td>
                          <td>{warehouse ?? <span className="chip warn">Not routed</span>}</td>
                          <td>
                            {c.destination ?? o?.destination ?? "–"}
                            {region && <span className="muted"> · {words(region)}</span>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <select
                              className="select"
                              aria-label={`Carrier for ${c.id}`}
                              style={{ minWidth: 210 }}
                              value={c.assigned ?? ""}
                              disabled={choosing !== null || assigning || !!assignment}
                              aria-busy={choosing === c.id}
                              onChange={(e) => choose(c, e.target.value)}
                            >
                              {!c.agent_assigned && <option value="">Not assigned</option>}
                              {[...new Set([...(c.assigned ? [c.assigned] : []), ...plan.input.carriers.map((x) => x.carrierName)])].map((name) => (
                                <option key={name} value={name}>
                                  Carrier {name}
                                  {name === c.agent_assigned ? " (agent’s pick)" : ""}
                                </option>
                              ))}
                            </select>
                            {c.chosen_at ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                Changed by staff; the agent picked {c.agent_assigned ?? "none"}
                              </div>
                            ) : (
                              c.assigned && c.recommended && c.recommended !== c.assigned && (
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {c.recommended} ranked first{c.review.includes("CAPACITY_REASSIGNED") ? " but was full" : "; the agent gave no reason for moving it"}
                                </div>
                              )
                            )}
                          </td>
                          <td className="num">{c.on_time_baseline_pct === null ? "–" : `${c.on_time_baseline_pct}%`}</td>
                          <td className="num">{money(c.assigned_price)}</td>
                          <td>{c.risk ? <span className={`chip ${RISK_CHIP[c.risk.toLowerCase()] ?? ""}`}>{words(c.risk)}</span> : "–"}</td>
                          <td>
                            {assignment ? (
                              <>
                                <span className={`chip ${assignment.delivered ? "ok" : "blue"}`}>{assignment.delivered ? "Delivered" : "Assigned"}</span>
                                <span className="sub">{assignment.delivered ? "at" : "delivery by"} {time(assignment.deliveredAt)}</span>
                              </>
                            ) : cleared.has(c.id) ? (
                              <span className="chip ok">Cleared</span>
                            ) : c.dispatch_ready ? (
                              <>
                                <span className="chip bad">Held</span>
                                <span className="sub">plan failed validation</span>
                              </>
                            ) : (
                              <>
                                <span className="chip warn">Review</span>
                                {c.review.length > 0 && <span className="sub">{c.review.map(reviewLabel).join(", ")}</span>}
                              </>
                            )}
                          </td>
                          <td className="wrap">{c.chosen_at ? `Staff’s choice at ${time(c.chosen_at)}` : (c.reason ?? "–")}</td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={9} style={{ background: "var(--raised)", fontSize: 13 }}>
                              <p className="muted" style={{ margin: "0 0 8px" }}>
                                {[
                                  c.priority && `${words(c.priority)} priority`,
                                  c.region_basis && `region from ${c.region_basis}`,
                                  c.capacity_after_assignment !== null && `${c.capacity_after_assignment} left on ${c.assigned} after this order`,
                                  sameDay && `same-day ${words(sameDay.status).toLowerCase()}`,
                                  sameDay?.earliest_pickup && `pickup ${sameDay.earliest_pickup}${sameDay.same_day_cutoff ? `–${sameDay.same_day_cutoff}` : ""}`,
                                  sameDay && `delivery commitment ${sameDay.commitment_verified ? "verified" : "not verified"}`,
                                  sameDay && `pickup ${sameDay.appointment_booked ? "booked" : "not booked"}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                              {!c.ranking.length && <p className="muted" style={{ margin: 0 }}>The agent couldn’t rank carriers for this order.</p>}
                              <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                                {c.ranking.map((r) => (
                                  <li key={r.carrier}>
                                    <b>Carrier {r.carrier}</b>
                                    <span className="muted">
                                      {" "}
                                      · score {r.score ?? "–"} · late {r.late_pct == null ? "–" : `${r.late_pct}%`} · {money(r.price)}
                                      {r.tie_break && ` · tie broken on ${r.tie_break}`}
                                    </span>
                                    {r.available_at_assignment === false && <span className="chip warn" style={{ marginLeft: 8 }}>Full</span>}
                                  </li>
                                ))}
                              </ol>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">The agent’s reply isn’t the JSON plan the page expects, so it’s shown as written below.</p>
          )}
          {parsed && parsed.summary.missing_data.length > 0 && (
            <p className="help" style={{ marginTop: 12 }}>
              Missing from the carrier data: {parsed.summary.missing_data.join("; ")}.
            </p>
          )}
        </section>
      )}

      {parsed && (parsed.capacity.length > 0 || parsed.pickup_groups.length > 0) && <CapacityAndPickups plan={parsed} />}

      {plan && plan.input.carriers.length > 0 && <CarrierFigures carriers={plan.input.carriers} highlight={regionsToday} />}

      {plan?.report && (
        <details className="card" style={{ padding: "16px 24px" }} open={!parsed}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            {parsed ? "How" : "Full reply from"} {plan.agent ?? "the carrier agent"}
            {parsed && " decided"}
          </summary>
          {parsed ? (
            <>
              <AgentSummary plan={parsed} />
              <details style={{ marginTop: 12 }}>
                <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Raw JSON reply</summary>
                <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: "18px", margin: "8px 0 0" }}>
                  {JSON.stringify(jsonOf(plan.report), null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: "20px", margin: "12px 0 0" }}>
              {plan.report}
            </pre>
          )}
          <p className="help" style={{ marginTop: 12 }}>
            {plan.runBy ? "Run again by staff" : "Made after the cutoff"} at {time(plan.createdAt)}. Late-delivery rates are historical; prices are
            averages, not quotes.
          </p>
        </details>
      )}

      {parsed && (
        <section className="card" style={{ padding: "20px 24px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }} aria-label="Assign orders">
          <div style={{ flex: 1, minWidth: 240 }}>
            <h3 style={H3}>Assign to carriers</h3>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
              Locks in the carrier shown for each order, including orders under review. An assigned order can’t be changed. It’s marked delivered 4–5
              hours later: a simulated time, as there’s no carrier tracking yet. Orders with no warehouse or carrier wait for the next plan.
              {rejected.length > 0 && " This plan failed validation, so check each carrier above first. Assigning anyway is recorded in the audit log."}
            </p>
          </div>
          <button className="btn btn-primary" type="button" disabled={assigning || choosing !== null || !ready.length} aria-busy={assigning} onClick={assign}>
            {assigning && <Spinner />}
            {assigning ? "Assigning…" : `Assign ${ready.length} ${ready.length === 1 ? "order" : "orders"}${rejected.length ? " anyway" : ""}`}
          </button>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{label}</p>
      <p style={{ margin: "4px 0 0", fontSize: 20, lineHeight: "28px", fontWeight: 600 }}>{value}</p>
    </div>
  );
}

// The agent's own summary of the batch and the rules it worked to, as plain lines.
function AgentSummary({ plan }: { plan: AgentPlan }) {
  const s = plan.summary;
  const rows: [string, React.ReactNode][] = [
    ["Outcome", plan.status ? words(plan.status) : null],
    ["Lowest price", s.lowest_price && `Carrier ${s.lowest_price.carrier} at ${money(s.lowest_price.price)}`],
    [
      "Most reliable",
      s.most_reliable_by_region.length > 0 &&
        s.most_reliable_by_region.map((r) => `${words(r.region)}: Carrier ${r.carrier} (${r.late_pct}% late)`).join(" · "),
    ],
    ["To review", s.review_order_ids.length > 0 && <span className="mono">{s.review_order_ids.join(", ")}</span>],
    ["Missing data", s.missing_data.length > 0 && s.missing_data.map((m) => words(m).toLowerCase()).join(", ")],
    ["Scoring", plan.basis],
    ["Allocation", plan.allocation_method],
  ];
  return (
    <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "8px 16px", fontSize: 13 }}>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <Fragment key={k}>
            <dt className="muted">{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

// How full each carrier is after the batch, and the pickups to arrange: one per carrier and region with same-day orders.
function CapacityAndPickups({ plan }: { plan: AgentPlan }) {
  return (
    <section className="card" style={{ padding: "20px 24px" }} aria-label="Carrier capacity and pickups">
      <h3 style={H3}>Capacity and pickups</h3>
      <p className="muted" style={SUB}>
        Orders go out same-day first, then high, then standard; each takes its best-ranked carrier that still has room. Capacity is assumed: a
        third of the orders on this plan, for each carrier. Pickup times are the carrier’s limits, not booked appointments.
      </p>
      {plan.capacity.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="num">Room before</th>
                <th className="num">Assigned</th>
                <th className="num">Left</th>
                <th>Status</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              {plan.capacity.map((c) => (
                <tr key={c.carrier}>
                  <td><b>Carrier {c.carrier}</b></td>
                  <td className="num">{c.before_batch ?? "–"}</td>
                  <td className="num">{c.assigned}</td>
                  <td className="num">{c.remaining ?? "–"}</td>
                  <td>{statusChip(c.status)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{c.order_ids.join(", ") || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan.pickup_groups.length > 0 && (
        <ul style={{ margin: "16px 0 0", paddingLeft: 20, display: "grid", gap: 6, fontSize: 13 }}>
          {plan.pickup_groups.map((g) => (
            <li key={`${g.carrier}|${g.region}`}>
              <b>Carrier {g.carrier}</b>
              {g.region && ` into the ${words(g.region)}`}:{" "}
              {g.earliest_pickup || g.same_day_cutoff
                ? `pickup from ${g.earliest_pickup ?? "–"}, same-day cutoff ${g.same_day_cutoff ?? "–"}`
                : "no pickup window in the data"}{" "}
              {statusChip(g.status)}
              <span className="muted mono"> {g.order_ids.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The figures the agent ranked on, laid out like the carrier slide: late rate by carrier and region, bad lanes red,
// and the regions today's orders go to marked.
function CarrierFigures({ carriers, highlight }: { carriers: PlanCarrier[]; highlight: Set<string | null> }) {
  const [hover, setHover] = useState<string | null>(null);
  const month = carriers[0]?.figuresMonth;
  const cheapest = Math.min(...carriers.map((c) => c.averageShippingPrice ?? Infinity));
  return (
    <section className="card" style={{ padding: "20px 24px" }} aria-label="Carrier figures">
      <h3 style={H3}>The cheapest carriers hold every bad lane</h3>
      <p className="muted" style={SUB}>
        Late rate by carrier and destination region, all deliveries{month ? ` to ${month}` : ""}: what the agent ranked on. Red is above{" "}
        {BAD_LATE_ABOVE}%; ● marks a region today’s same-day orders go to.
      </p>
      <div className="tbl-wrap">
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 2, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th className="muted" style={{ textAlign: "left", fontWeight: 500, fontSize: 13, padding: "8px 12px" }}>Carrier</th>
              {REGIONS.map((r) => (
                <th key={r} className="muted" style={{ fontWeight: 500, fontSize: 13, padding: "8px 12px" }}>
                  {r}
                  {highlight.has(r) && <span style={{ color: "var(--text)" }}> ●</span>}
                </th>
              ))}
              <th className="muted" style={{ fontWeight: 500, fontSize: 13, padding: "8px 12px" }}>Avg rate</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((c) => (
              <tr key={c.carrierName}>
                <th scope="row" style={{ textAlign: "left", fontWeight: 600, fontSize: 14, padding: "0 12px", whiteSpace: "nowrap" }}>
                  {c.carrierName}
                  {c.preferredSupplier && (
                    <span className="chip warn" style={{ marginLeft: 8 }}>
                      preferred
                    </span>
                  )}
                </th>
                {REGIONS.map((r) => {
                  const late = c.regionalLateDeliveryRates[r];
                  const bad = late !== null && late > BAD_LATE_ABOVE;
                  const key = `${c.carrierName}|${r}`;
                  return (
                    <td
                      key={key}
                      tabIndex={0}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(key)}
                      onBlur={() => setHover(null)}
                      aria-label={`Carrier ${c.carrierName} into the ${r}: ${late === null ? "no deliveries" : `${Math.round(late)}% late`}`}
                      style={{
                        background: bad ? "var(--bad-soft)" : "var(--raised)",
                        color: bad ? "var(--bad)" : "var(--text)",
                        textAlign: "center",
                        padding: "14px 8px",
                        fontWeight: 600,
                        fontSize: 15,
                        borderRadius: 4,
                        outline: hover === key ? "2px solid var(--text)" : undefined,
                        outlineOffset: -2,
                      }}
                    >
                      {late === null ? "–" : `${Math.round(late)}%`}
                    </td>
                  );
                })}
                <td
                  style={{
                    textAlign: "center",
                    padding: "14px 8px",
                    fontWeight: 600,
                    fontSize: 15,
                    borderRadius: 4,
                    background: "var(--raised)",
                    color: c.averageShippingPrice === cheapest ? "var(--ok)" : "var(--text)",
                  }}
                >
                  {c.averageShippingPrice === null ? "–" : `$${c.averageShippingPrice.toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: "12px 0 0", fontSize: 13, minHeight: 20 }} aria-live="polite">
        {hover
          ? (() => {
              const [name, region] = hover.split("|");
              const late = carriers.find((c) => c.carrierName === name)!.regionalLateDeliveryRates[region as PlanRegion];
              return late === null
                ? `Carrier ${name} made no deliveries into the ${region}.`
                : `Carrier ${name} into the ${region}: ${late}% late, so about ${Math.round(100 - late)}% on time.`;
            })()
          : "D, E and F are the cheapest and hold every red lane; on same-day the carrier matters far less than the 08:00 cutoff (see Insights)."}
      </p>
    </section>
  );
}
