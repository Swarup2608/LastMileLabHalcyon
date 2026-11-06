"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";
import { emailsApi, IGNORED_LABEL, type EmailPage } from "@/lib/emails";
import {
  buildRequest,
  initials,
  saveEdits,
  seedEdits,
  useAllEdits,
  useAutoRoute,
  useStock,
  when,
  type AskKey,
  type OrderRequest,
  type RequestEdits,
} from "@/lib/order-request";
import RqIcon from "./requests/RqIcon";

// The newest emails the queue works through; older ones are past handling.
const QUEUE_SIZE = 200;
// Items listed in a row before the rest fold into "+N more"; the expanded row lists them all.
const ROW_ITEMS = 3;

type Tab = "needs" | "ready" | "asked" | "routed" | "ignored";
const TABS: [Tab, string][] = [
  ["needs", "Needs information"],
  ["ready", "Ready to route"],
  ["asked", "Waiting on customer"],
  ["routed", "Routed"],
  ["ignored", "Ignored"],
];
// Ignored emails (blank, repeats, no order found, or set aside by staff) leave every other tab and are never auto-routed.
const tabOf = (r: OrderRequest): Tab => (r.email.ignored ? "ignored" : r.status === "agent" ? "needs" : r.status);

// Filters by what's wrong with a request; a request shows when it has any of the picked problems.
const PROBLEMS: [AskKey, string][] = [
  ["product", "Product mismatch"],
  ["qty", "Quantity missing"],
  ["address", "Address incomplete"],
];

// How each blocker reads in "Ask for …".
const ASK: Record<string, string> = {
  "Not in catalogue": "product details",
  Product: "what they’d like to order",
  Quantity: "quantity",
  "Shipping address": "shipping address",
  "Postal code": "the postal code",
  Street: "the street",
  City: "the city",
  State: "the state",
};
const BULK_BODY =
  "Hi,\n\nThanks for your order request. Before we can ship it, we need a little more from you: please reply with the exact product (brand and model, or a link), how many you need, and your full shipping address (street, city, state and postal code).\n\nBest,\nHalcyon Orders";

const pct = (n: number) => `${Math.round(n)}%`;
const shipTo = (r: OrderRequest) =>
  [r.address.street, r.address.suite, r.address.city, r.address.region, r.address.postal, r.address.country].filter(Boolean).join(", ");

// Order requests from the polled inbox, oldest first within each tab: what the agent read from each email and what
// still stops it shipping. A row opens in place to its details; from there Resolve fixes it and Request info asks
// the customer in the email thread. Refreshes every 30 seconds.
export default function EmailsView() {
  const router = useRouter();
  const [page, setPage] = useState<EmailPage | null>(null);
  const [error, setError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<Tab>("needs");
  const [query, setQuery] = useState("");
  const [problems, setProblems] = useState<AskKey[]>([]);
  // undefined until the first load picks the oldest request needing information; null when all are closed.
  const [expanded, setExpanded] = useState<string | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [requested, setRequested] = useState<{ ids: string[]; before: Record<string, RequestEdits | undefined> } | null>(null);
  const { stock } = useStock();
  const edits = useAllEdits();

  useEffect(() => {
    let active = true;
    const load = () =>
      emailsApi.list(QUEUE_SIZE, 0).then(
        (result) => {
          if (!active) return;
          seedEdits(result.emails);
          setPage(result);
          setError(false);
        },
        () => active && setError(true),
      );
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [reload]);

  const requests = useMemo(
    () => (page && stock ? page.emails.map((e) => buildRequest(e, stock.products, edits[e.id])) : null),
    [page, stock, edits],
  );
  const queued = useMemo(() => requests?.filter((r) => !r.email.ignored) ?? null, [requests]);
  useAutoRoute(queued, stock, (routed) =>
    toast.success(
      routed.length === 1
        ? `${routed[0].request.ref} had everything in stock, so it’s routed to ${routed[0].warehouse.warehouseName ?? routed[0].warehouse.warehouseId}`
        : `${routed.length} complete requests had everything in stock, so they’re routed`,
    ),
  );

  const analyzeNow = async () => {
    setAnalyzing(true);
    try {
      const { analyzed, failed } = await emailsApi.analyze();
      if (failed) toast.error(`${analyzed} analyzed, ${failed} failed; they’re retried on the next poll`);
      else toast.success(analyzed ? `${analyzed} email${analyzed === 1 ? "" : "s"} analyzed` : "Nothing left to analyze");
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 503 ? "The email agent isn’t configured on the API" : "We couldn’t reach Halcyon");
    } finally {
      setAnalyzing(false);
    }
  };

  const total = page?.total ?? 0;
  const analyzed = page?.analyzed ?? 0;
  const counts = Object.fromEntries(TABS.map(([k]) => [k, requests?.filter((r) => tabOf(r) === k).length ?? 0])) as Record<Tab, number>;
  const q = query.trim().toLowerCase();
  const rows = (requests ?? []).filter(
    (r) =>
      tabOf(r) === tab &&
      (!problems.length || (r.status !== "agent" && problems.some((k) => !r.resolved[k]))) &&
      (!q ||
        [r.customer, r.sender.name, r.sender.email, r.contact.primary, r.ref, r.email.subject, ...r.lines.map((l) => l.asked)]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  const openId = expanded === undefined ? (requests?.find((r) => tabOf(r) === "needs")?.email.id ?? null) : expanded;
  const sel = selected.filter((id) => rows.some((r) => r.email.id === id));
  const allSel = rows.length > 0 && sel.length === rows.length;
  const cbState = allSel ? "true" : sel.length ? "mixed" : "false";

  const go = (r: OrderRequest, reply = false) => router.push(`/portal/emails/${encodeURIComponent(r.email.id)}${reply ? "/reply" : ""}`);
  const switchTab = (k: Tab) => {
    setTab(k);
    setSelected([]);
    setExpanded(k === "needs" ? undefined : null);
  };
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // One email to everyone selected (Bcc, so they don't see each other), and each request moves to Waiting on customer.
  const requestSelected = () => {
    const picked = rows.filter((r) => sel.includes(r.email.id) && r.status === "needs");
    if (!picked.length) return;
    const bcc = picked.map((r) => r.contact.primary).join(",");
    window.location.href = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent("Your order request")}&body=${encodeURIComponent(BULK_BODY)}`;
    const at = new Date().toISOString();
    const before = Object.fromEntries(picked.map((r) => [r.email.id, edits[r.email.id]]));
    for (const r of picked) saveEdits(r.email.id, { ...edits[r.email.id], asked: { keys: ["product", "qty", "address"], at, text: BULK_BODY } });
    setRequested({ ids: picked.map((r) => r.email.id), before });
    setSelected([]);
    setExpanded(null);
  };
  // Takes the selected (or one) request out of the queue, or puts it back.
  const setIgnored = async (ids: string[], ignore: boolean) => {
    try {
      await Promise.all(ids.map((id) => emailsApi.setIgnored(id, ignore)));
      toast.success(`${ids.length} ${ids.length === 1 ? "request" : "requests"} ${ignore ? "ignored" : "restored to the queue"}`);
    } catch {
      toast.error("We couldn’t update every request; refresh and try again");
    }
    setSelected([]);
    setExpanded(null);
    setReload((n) => n + 1);
  };
  const undoRequested = () => {
    if (!requested) return;
    for (const id of requested.ids) saveEdits(id, { ...requested.before[id] });
    setRequested(null);
  };

  return (
    <div className="rq">
      <div className="rq-q-top">
        <div>
          <div className="rq-crumb">Halcyon · Orders</div>
          <h1>Order requests</h1>
        </div>
        <div className="rq-acts">
          {requested && (
            <span className="rq-toast">
              <RqIcon name="checkCircle" />
              Info requested from {requested.ids.length} {requested.ids.length === 1 ? "customer" : "customers"}
              <button className="btn btn-quiet btn-sm" type="button" onClick={undoRequested}>
                <RqIcon name="undo" />
                Undo
              </button>
            </span>
          )}
          <button className="btn btn-secondary" type="button" onClick={analyzeNow} disabled={analyzing} aria-busy={analyzing}>
            {analyzing ? <Spinner /> : <RqIcon name="inbox" />}
            {analyzing ? "Analyzing…" : "Analyze now"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card empty" role="alert">
          <RqIcon name="alert" />
          We couldn’t load emails from Halcyon. Refresh the page to try again.
        </div>
      ) : (
        <>
          <section className="rq-stats card" aria-label="Inbox summary">
            <Stat label="Received" value={total.toLocaleString("en-US")} />
            <Stat
              label="Read by the agent"
              value={total ? pct((analyzed / total) * 100) : "–"}
              note={`${analyzed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
              meter={total ? analyzed / total : 0}
            />
            <Stat label="Need information" value={String(counts.needs)} tone={counts.needs ? "warn" : undefined} />
            <Stat label="Ready to route" value={String(counts.ready)} tone={counts.ready ? "ok" : undefined} />
          </section>

          <section className="card rq-queue" aria-label="Order requests">
            <div className="rq-tabs" role="tablist" aria-label="Request status">
              {TABS.map(([k, label]) => (
                <button key={k} className="rq-tab" role="tab" type="button" aria-selected={tab === k} onClick={() => switchTab(k)}>
                  {label}
                  <span className="count">{counts[k]}</span>
                </button>
              ))}
            </div>
            {sel.length ? (
              <div className="rq-bulk">
                {sel.length} selected
                {tab === "needs" && (
                  <button className="btn btn-primary btn-sm" type="button" onClick={requestSelected}>
                    <RqIcon name="mail" />
                    Request info
                  </button>
                )}
                {tab === "ignored" ? (
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setIgnored(sel, false)}>
                    <RqIcon name="undo" />
                    Restore
                  </button>
                ) : (
                  tab !== "routed" && (
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => setIgnored(sel, true)}>
                      Ignore
                    </button>
                  )
                )}
                <button className="btn btn-quiet btn-sm" type="button" onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
            ) : (
              <div className="rq-toolbar">
                <label className="rq-search">
                  <span className="sr">Search requests</span>
                  <RqIcon name="search" />
                  <input className="input" placeholder="Search name, product or ref" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <div className="rq-ask-chips" role="group" aria-label="Filter by problem">
                  {PROBLEMS.map(([k, label]) => {
                    const on = problems.includes(k);
                    return (
                      <button
                        key={k}
                        className="rq-ask-chip"
                        type="button"
                        aria-pressed={on}
                        onClick={() => setProblems((p) => (on ? p.filter((x) => x !== k) : [...p, k]))}
                      >
                        <RqIcon name={on ? "check" : "plus"} />
                        {label}
                      </button>
                    );
                  })}
                </div>
                <span className="rq-faint" style={{ marginLeft: "auto" }}>Oldest first</span>
              </div>
            )}

            {!requests ? (
              <div className="empty" aria-busy="true">Loading requests…</div>
            ) : !rows.length ? (
              <div className="empty">
                <RqIcon name={tab === "routed" ? "box" : "inbox"} className="lg" />
                <b>
                  {q
                    ? `No requests match “${query}”`
                    : problems.length
                      ? "No requests with those problems"
                      : tab === "routed"
                        ? "Nothing routed yet"
                        : tab === "ignored"
                          ? "Nothing ignored"
                          : "All caught up"}
                </b>
                <span>
                  {q
                    ? "Try a name, product or reference."
                    : tab === "routed"
                      ? "Orders appear here once a warehouse is chosen."
                      : tab === "asked"
                        ? "Requests you’ve asked the customer about wait here."
                        : tab === "ignored"
                          ? "Blank emails, repeats and emails with no order land here instead of the queue."
                          : "New order emails land here when details are missing."}
                </span>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="rq-tbl">
                  <thead>
                    <tr>
                      <th className="chk">
                        <Check
                          state={cbState}
                          label="Select all"
                          onClick={() => setSelected(allSel ? [] : rows.map((r) => r.email.id))}
                        />
                      </th>
                      <th>Customer</th>
                      <th>Items</th>
                      <th>Ship to</th>
                      <th>{tab === "needs" ? "Missing" : "Status"}</th>
                      <th>Received</th>
                      <th><span className="sr">Details</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const id = r.email.id;
                      const open = openId === id;
                      const isSel = sel.includes(id);
                      const more = r.lines.length - ROW_ITEMS;
                      return (
                        <Fragment key={id}>
                          <tr
                            className={`row${open ? " open" : ""}${isSel ? " sel" : ""}`}
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : id)}
                          >
                            <td className="chk">
                              <Check
                                state={isSel ? "true" : "false"}
                                label={`Select ${r.customer ?? r.sender.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSel(id);
                                }}
                              />
                            </td>
                            <td>
                              <div className="rq-who">
                                <span className="rq-av">{initials(r.customer ?? r.sender.name)}</span>
                                <span>
                                  <b>{r.customer ?? r.sender.name}</b>
                                  <small>{r.customer && r.customer !== r.sender.name ? `via ${r.sender.name}` : r.contact.primary}</small>
                                </span>
                              </div>
                            </td>
                            <td>
                              {r.lines.length ? (
                                <div className="rq-items">
                                  {r.lines.slice(0, ROW_ITEMS).map((l) => (
                                    <span key={l.key}>
                                      {l.asked}{" "}
                                      <span className={`rq-qty${l.quantity ? "" : " missing"}`}>{l.quantity ? `×${l.quantity}` : "× ?"}</span>
                                    </span>
                                  ))}
                                  {more > 0 && <span className="rq-faint">+{more} more</span>}
                                </div>
                              ) : (
                                <span className="rq-empty">{r.status === "agent" ? "Not read yet" : "No items"}</span>
                              )}
                            </td>
                            <td>{shipTo(r) || <span className="rq-empty">No address</span>}</td>
                            <td>
                              <div className="rq-chips">
                                {r.email.ignored ? (
                                  <span className="rq-pill neutral"><span className="dot" />{IGNORED_LABEL[r.email.ignored.reason]}</span>
                                ) : r.status === "agent" ? (
                                  <span className="rq-pill neutral"><span className="dot" />Agent reading</span>
                                ) : r.status === "routed" ? (
                                  <span className="rq-pill ok"><span className="dot" />Routed</span>
                                ) : r.status === "asked" ? (
                                  <span className="rq-pill info"><span className="dot" />Asked {when(edits[id]!.asked!.at)}</span>
                                ) : r.blockers.length ? (
                                  r.blockers.map((b) => <span key={b} className="rq-pill warn">{b}</span>)
                                ) : (
                                  <span className="rq-pill ok"><span className="dot" />Complete</span>
                                )}
                              </div>
                            </td>
                            <td className="rq-faint rq-nowrap">{when(r.email.receivedAt)}</td>
                            <td className="rq-chev-cell"><RqIcon name="chevron" className="rq-chev" /></td>
                          </tr>
                          {open && (
                            <Detail
                              r={r}
                              routedTo={edits[id]?.routed?.warehouseIds}
                              onResolve={() => go(r)}
                              onRequest={() => go(r, true)}
                              onIgnore={r.email.channel === "email" && r.status !== "routed" ? (ignore) => setIgnored([id], ignore) : undefined}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="rq-foot">
              <span>
                {rows.length} {rows.length === 1 ? "request" : "requests"}
              </span>
              <span>Updated every 30 seconds</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// The row opened in place: every field the agent read, what's still missing, and where to go next.
function Detail({
  r,
  routedTo,
  onResolve,
  onRequest,
  onIgnore,
}: {
  r: OrderRequest;
  routedTo?: string[];
  onResolve: () => void;
  onRequest: () => void;
  // Undefined when it can't be ignored (an API order, or one already routed).
  onIgnore?: (ignore: boolean) => void;
}) {
  const ignored = r.email.ignored;
  const missing = (label = "Not given") => <span className="rq-empty">{label}</span>;
  const ship = shipTo(r);
  const live = r.lines.filter((l) => !l.declined);
  return (
    <tr className="detail">
      <td colSpan={7}>
        <div className="rq-fade">
          <dl className="rq-detail-grid">
            <div>
              <dt>Ref</dt>
              <dd className="mono">{r.ref}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{r.customer ?? missing()}</dd>
            </div>
            <div>
              <dt>Reply to</dt>
              <dd>
                {r.contact.primary}
                {r.contact.secondary && <small className="rq-sub">Cc {r.contact.secondary}</small>}
              </dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{when(r.email.receivedAt)}</dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>
                {r.lines.length
                  ? r.lines.map((l) => (
                      <span key={l.key} className="rq-dd-line">
                        {l.asked}
                        {l.declined ? (
                          <span className="rq-pill neutral">Declined</span>
                        ) : !l.product ? (
                          <span className="rq-pill warn">Not in catalogue</span>
                        ) : null}
                      </span>
                    ))
                  : missing()}
              </dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>
                {live.length
                  ? live.map((l) => (
                      <span key={l.key} className="rq-dd-line">
                        {l.quantity ?? missing()}
                        {live.length > 1 && <small className="rq-faint">{l.asked}</small>}
                      </span>
                    ))
                  : missing()}
              </dd>
            </div>
            <div>
              <dt>Ship to</dt>
              <dd>{ship || missing()}</dd>
            </div>
            <div>
              <dt>Warehouse</dt>
              <dd>{routedTo?.length ? routedTo.join(", ") : r.blockers.length ? missing("Waits on details") : "Ready to rank"}</dd>
            </div>
          </dl>
          {r.customer && r.customer !== r.sender.name && (
            <p className="rq-note">
              <RqIcon name="info" />
              <span>
                Sent by {r.sender.name}, signed {r.customer}.{r.contact.fromBody ? ` Replies go to ${r.contact.primary}, given in the email.` : ""}
              </span>
            </p>
          )}
          {ignored && (
            <p className="rq-note">
              <RqIcon name="info" />
              <span>
                {IGNORED_LABEL[ignored.reason]}
                {ignored.duplicateOf ? `: the same sender, subject and order as REQ-${ignored.duplicateOf.slice(-6).toUpperCase()}` : ""}. It stays out
                of the queue and isn’t routed. Restore it if it’s a real order.
              </span>
            </p>
          )}
          <div className="rq-detail-actions">
            <span className="muted">
              {ignored
                ? "Ignored"
                : r.status === "agent"
                  ? "The agent hasn’t read this email yet."
                  : r.blockers.length
                    ? `Ask for ${[...new Set(r.blockers.map((b) => ASK[b] ?? b.toLowerCase()))].join(", ")}`
                    : "All details present"}
            </span>
            <div className="rq-acts">
              {onIgnore && (
                <button className="btn btn-quiet btn-sm" type="button" onClick={() => onIgnore(!ignored)}>
                  {ignored ? <RqIcon name="undo" /> : null}
                  {ignored ? "Restore" : "Ignore"}
                </button>
              )}
              {!ignored && r.blockers.length > 0 && r.status !== "agent" && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={onRequest}>
                  <RqIcon name="mail" />
                  Request info
                </button>
              )}
              {!ignored && (
                <button className="btn btn-primary btn-sm" type="button" onClick={onResolve} disabled={r.status === "agent"}>
                  {r.status === "routed" ? "View order" : r.blockers.length ? "Resolve" : "Route order"}
                </button>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// The design's checkbox: a button so the whole cell is the hit area and "mixed" can show for select-all.
function Check({ state, label, onClick }: { state: "true" | "false" | "mixed"; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button className="rq-cb" type="button" role="checkbox" aria-checked={state} aria-label={label} onClick={onClick}>
      {state === "true" ? <RqIcon name="check" /> : state === "mixed" ? <RqIcon name="minus" /> : null}
    </button>
  );
}

function Stat({ label, value, note, meter, tone }: { label: string; value: string; note?: string; meter?: number; tone?: "ok" | "warn" }) {
  return (
    <div className="rq-stat" data-tone={tone}>
      <span className="rq-eyebrow">{label}</span>
      <span className="rq-stat-v">
        {value}
        {note && <small>{note}</small>}
      </span>
      {meter !== undefined && (
        <span className="rq-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(meter * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
