"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { ApiError } from "@/lib/api";
import { emailsApi, jsonOf, type InboundEmail } from "@/lib/emails";
import {
  ASK_KEYS,
  buildRequest,
  decisionLines,
  planFor,
  seedEdits,
  totalAvailable,
  useAutoRoute,
  useRequestEdits,
  useStock,
  when,
  type Address,
  type AskKey,
  type Line,
  type OrderRequest,
  type RequestEdits,
} from "@/lib/order-request";
import type { Product } from "@/lib/products";
import { carrierStatus } from "@/lib/carrier-plan";
import { deliveryDay, deliveryReason } from "@/lib/settings";
import ClientCard from "./ClientCard";
import ReplyComposer from "./ReplyComposer";
import RqIcon from "./RqIcon";
import ShipFrom, { pickWarnings } from "./ShipFrom";
import StockFlagCard from "./StockFlagCard";

const pct = (n: number) => `${Math.round(n)}%`;

// Loads one email and its catalogue and stock, then hands over to the screen that needs them.
export function useRequestPage(id: string) {
  const [email, setEmail] = useState<InboundEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { stock, failed } = useStock();
  const [edits, update] = useRequestEdits(id);

  useEffect(() => {
    let active = true;
    emailsApi.get(id).then(
      (r) => {
        if (!active) return;
        seedEdits([r.email]);
        setEmail(r.email);
      },
      (err) => active && setError(err instanceof ApiError && err.status === 404 ? "This email isn’t in the inbox any more." : "We couldn’t load this email from Halcyon."),
    );
    return () => {
      active = false;
    };
  }, [id]);

  const request = useMemo(() => (email && stock ? buildRequest(email, stock.products, edits) : null), [email, stock, edits]);
  return { request, stock, edits, update, error: error ?? (failed ? "We couldn’t load the catalogue from Halcyon." : null) };
}

export function PageState({ error }: { error: string | null }) {
  return error ? (
    <div className="card empty" role="alert">
      <RqIcon name="alert" className="lg" />
      {error}
      <Link className="btn btn-secondary btn-sm" href="/portal/emails">Back to order requests</Link>
    </div>
  ) : (
    <div className="card empty" aria-busy="true">Loading the request…</div>
  );
}

export const titleOf = (r: OrderRequest) => {
  const items = r.lines.map((l) => l.product?.productName ?? l.asked);
  const what = items.length ? (items.length > 2 ? `${items[0]} and ${items.length - 1} more` : items.join(" and ")) : r.email.subject || "Order request";
  return r.customer ? `${what} for ${r.customer}` : what;
};

export function StatusPill({ request }: { request: OrderRequest }) {
  const s = request.status;
  if (s === "routed") return <span className="rq-pill ok"><span className="dot" />Routed</span>;
  if (s === "ready") return <span className="rq-pill ok"><span className="dot" />Ready to route</span>;
  if (s === "asked") return <span className="rq-pill info"><span className="dot" />Waiting on customer</span>;
  if (s === "agent") return <span className="rq-pill neutral"><span className="dot" />Agent reading</span>;
  return <span className="rq-pill warn"><span className="dot" />Needs information</span>;
}

// The Resolve screen: everything that stops an emailed order from shipping, one task each (product, quantity,
// address), with the option to ask the customer instead; then the warehouse to ship from and routing.
export default function ResolveView({ id }: { id: string }) {
  const { request, stock, edits, update, error } = useRequestPage(id);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const one = useMemo(() => (request ? [request] : null), [request]);
  // Opening the request after the customer answered counts as reviewing their answers (it leaves Exceptions).
  const answeredAt = edits.answered?.at;
  useEffect(() => {
    if (answeredAt && edits.answerReviewed !== answeredAt) update((e) => ({ ...e, answerReviewed: answeredAt }));
  }, [answeredAt, edits.answerReviewed, update]);
  useAutoRoute(one, stock, ([{ warehouse }]) => {
    setPicked(null);
    toast.success(`Everything’s in stock at ${warehouse.warehouseName ?? warehouse.warehouseId}, so it’s routed there`);
  });

  if (!request || !stock) return <PageState error={error} />;

  const r = request;
  const api = r.email.channel === "api";
  const ask = (k: AskKey) => !!edits.ask?.[k] && !r.resolved[k];
  const stateOf = (k: AskKey) => (r.resolved[k] ? "done" : ask(k) ? "asked" : "open");
  const states = ASK_KEYS.map(stateOf);
  const done = states.filter((s) => s === "done").length;
  const covered = states.filter((s) => s !== "open").length;
  const allDone = done === 3;
  const asks = ASK_KEYS.filter(ask);
  const routed = edits.routed;

  const plan = allDone ? planFor(r, stock.products, stock.warehouses) : null;
  const chosen = picked ?? new Set(routed?.warehouseIds ?? (plan?.suggested ? [plan.suggested.warehouse.warehouseId] : []));

  const setLine = (line: Line, change: NonNullable<RequestEdits["lines"]>[string]) =>
    update((e) => ({ ...e, lines: { ...e.lines, [line.key]: { ...e.lines?.[line.key], ...change } } }));
  const setAsk = (k: AskKey, on: boolean) => update((e) => ({ ...e, ask: { ...e.ask, [k]: on }, askAt: new Date().toISOString() }));
  const setAddress = (k: keyof Address, v: string) => update((e) => ({ ...e, address: { ...e.address, [k]: v } }));

  // Warehouses where stock is actually a problem: a chosen one that's short, the nearest one when it's short (a later
  // date from it is the alternative to shipping from farther), or every one when none can ship it all. Flagging out of
  // stock is only offered for these.
  const nearest = plan?.region ? [...plan.options].filter((o) => o.miles !== null).sort((a, b) => a.miles! - b.miles!)[0] : undefined;
  const shortIds = plan
    ? [
        ...new Set([
          ...plan.options.filter((o) => chosen.has(o.warehouse.warehouseId) && !o.canShip).map((o) => o.warehouse.warehouseId),
          ...(nearest && !nearest.canShip ? [nearest.warehouse.warehouseId] : []),
          ...(!plan.suggested ? plan.options.map((o) => o.warehouse.warehouseId) : []),
        ]),
      ]
    : [];

  // A pick other than the suggested warehouse is routed as an override, with what was wrong with it.
  const warnings = plan ? pickWarnings(plan, chosen) : [];
  const route = () => {
    const override = warnings.length ? { override: warnings } : {};
    // Routing by hand counts as intake too when the ready check hasn't stamped it yet.
    update((e) => {
      const at = new Date().toISOString();
      return { ...e, intakeAt: e.intakeAt ?? at, routed: { warehouseIds: [...chosen], at, ...override, lines: decisionLines(r) } };
    });
    toast.success(`Routed to ${[...chosen].map((w) => stock.warehouses.find((x) => x.warehouseId === w)?.warehouseName ?? w).join(" and ")}`);
    // The API logs it as a stock-out when the nearest warehouse was short and it ships from somewhere else.
    if (nearest && !nearest.canShip) {
      toast(`Logged as a stock-out at ${nearest.warehouse.warehouseName ?? nearest.warehouse.warehouseId}, the nearest warehouse`);
    }
  };
  // Staff undoing a route keep it unrouted until they route it themselves.
  const unroute = () => {
    setPicked(null);
    update((e) => ({ ...e, routed: undefined, hold: true }));
  };

  // The reply to the customer, written here: it asks for whatever is marked to ask, and when nothing is yet, for
  // everything still open.
  const open = ASK_KEYS.filter((k) => !r.resolved[k]);
  const showComposer = !routed && !allDone && (!!edits.asked || asks.length > 0 || composing);
  const requestInfo = () => {
    if (!asks.length) update((e) => ({ ...e, ask: Object.fromEntries(open.map((k) => [k, true])), askAt: new Date().toISOString() }));
    setComposing(true);
    requestAnimationFrame(() => composer.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const num = (k: AskKey, n: number) => {
    const s = stateOf(k);
    return (
      <span className={`rq-num ${s === "done" ? "done" : s === "asked" ? "asked" : ""}`}>
        {s === "done" ? <RqIcon name="check" /> : s === "asked" ? <RqIcon name="mail" /> : n}
      </span>
    );
  };
  const askSwitch = (k: AskKey) =>
    r.resolved[k] ? null : (
      <button className="rq-switch" type="button" role="switch" aria-checked={ask(k)} onClick={() => setAsk(k, !ask(k))}>
        <span className="track" />
        Ask the customer instead
      </button>
    );
  const task = (k: AskKey, n: number, title: string, desc: string, body: ReactNode, need: string) => (
    <section className="card rq-task">
      <div className="rq-task-head">
        {num(k, n)}
        <div>
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
      </div>
      <div className="rq-task-body">{body}</div>
      {!r.resolved[k] && (
        <div className="rq-task-foot">
          <span className="rq-faint">{need}</span>
          {askSwitch(k)}
        </div>
      )}
    </section>
  );

  const sameName = (p: Product) => stock.products.filter((c) => c.productName === p.productName).length;
  const unmatched = r.lines.filter((l) => !l.product && !l.declined);
  const noQty = r.lines.filter((l) => !l.declined && !(l.quantity && l.quantity > 0));
  const gaps = (["street", "city", "region", "postal"] as const).filter((k) => !r.address[k].trim());

  const productBody = !r.lines.length ? (
    <p className="muted">The agent didn’t find a product in this email. Ask the customer what they’d like to order.</p>
  ) : (
    <div className="rq-lines">
      {r.lines.map((l) =>
        l.product ? (
          <div key={l.key} className="rq-resolved">
            <RqIcon name="checkCircle" />
            <span>
              {l.asked !== l.product.productName && <span className="rq-faint">“{l.asked}” → </span>}
              Mapped to <b>{l.product.productName}</b> <span className="rq-faint mono">{l.product.sku}</span> ·{" "}
              {totalAvailable(l.product).toLocaleString("en-US")} in stock
              {sameName(l.product) > 1 && (
                <small className="rq-sub">
                  {sameName(l.product)} products share this name; this is {l.product.clientName ?? l.product.clientId}’s. Change it if they meant another.
                </small>
              )}
            </span>
            {!routed && (
              <button className="btn btn-quiet btn-sm" type="button" onClick={() => setLine(l, { productId: null, declined: false })}>
                Change
              </button>
            )}
          </div>
        ) : l.declined ? (
          <div key={l.key} className="rq-resolved">
            <RqIcon name="checkCircle" />
            <span>“{l.asked}” declined. The reply will say this item isn’t available.</span>
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setLine(l, { declined: false })}>
              Undo
            </button>
          </div>
        ) : ask("product") ? (
          <p key={l.key} className="muted">We’ll ask for a brand and model, or a link, for “{l.asked}”.</p>
        ) : (
          <div key={l.key} className="rq-match">
            <span className="rq-faint">“{l.asked}”</span>
            <div className="rq-match-row">
              <ProductPicker catalogue={stock.products} initial={l.asked} onPick={(p) => setLine(l, { productId: p.productId, declined: false })} />
              <button className="btn btn-secondary" type="button" onClick={() => setLine(l, { declined: true })}>
                Decline item
              </button>
            </div>
          </div>
        ),
      )}
    </div>
  );

  const qtyBody =
    ask("qty") ? (
      <p className="muted">We’ll ask how many, and assume one if they don’t say.</p>
    ) : !r.lines.length ? (
      <p className="muted">Waits on the product.</p>
    ) : (
      <div className="rq-lines">
        {r.lines
          .filter((l) => !l.declined)
          .map((l) => (
            <div key={l.key} className="rq-qty-row">
              <Stepper value={l.quantity} disabled={!!routed} label={`Quantity of ${l.product?.productName ?? l.asked}`} onChange={(q) => setLine(l, { quantity: q })} />
              <span className="rq-faint">× {l.product?.productName ?? l.asked}</span>
              {!l.quantity && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setLine(l, { quantity: 1 })}>
                  Use 1
                </button>
              )}
            </div>
          ))}
      </div>
    );

  const field = (k: keyof Address, label: string, cls: string, placeholder: string) => (
    <div className={cls}>
      <label className="rq-label" htmlFor={`a-${k}`}>{label}</label>
      <input
        id={`a-${k}`}
        className="input"
        value={r.address[k]}
        placeholder={placeholder}
        autoComplete="off"
        disabled={!!routed}
        aria-invalid={k !== "suite" && k !== "country" && !r.address[k].trim() ? true : undefined}
        onChange={(e) => setAddress(k, e.target.value)}
      />
    </div>
  );
  const addressBody =
    ask("address") ? (
      <p className="muted">We’ll ask for the full address. Warehouse choice waits on it.</p>
    ) : (
      <div className="rq-addr">
        {field("street", "Street", "c4", "Street and number")}
        {field("suite", "Suite or unit (optional)", "c2", "Apt, suite, floor")}
        {field("city", "City", "c2", "City")}
        {field("region", "State", "c2", "State")}
        {field("postal", "Postal code", "c2", "Postal code")}
        {field("country", "Country (optional)", "c6", "Country")}
      </div>
    );

  const pipeline: [state: "ok" | "block" | "wait", title: string, detail: string][] = [
    ["ok", api ? "Placed through the API" : "Email received", when(r.email.receivedAt)],
    [r.email.readByAi ? "ok" : "wait", "Details extracted", api ? "Sent structured by the client" : r.email.readByAi ? `Read by the agent${r.score !== null ? ` · ${pct(r.score)} sure` : ""}` : "Waiting for the agent"],
    [r.resolved.product ? "ok" : "block", "Product matched", r.resolved.product ? r.lines.filter((l) => l.product).map((l) => l.product!.productName).join(", ") || "Items declined" : unmatched.length ? "Not in catalogue" : "No product yet"],
    [r.resolved.address ? "ok" : "block", "Destination known", r.resolved.address ? [r.address.city, r.address.region].join(", ") : "No address yet"],
    [routed ? "ok" : allDone ? "block" : "wait", "Warehouse selected", routed ? routed.warehouseIds.join(", ") : allDone ? "Ready to rank by stock and distance" : "Waits on product and address"],
  ];

  return (
    <div className="rq">
      <div className="rq-head">
        <div>
          <div className="rq-crumb">
            <Link href="/portal/emails">Order requests</Link>
            <RqIcon name="chevR" />
            <span className="mono">{r.ref}</span>
          </div>
          <h1 className="rq-title">{titleOf(r)}</h1>
          <div className="rq-meta">
            <span><RqIcon name="mail" />{r.sender.name} · {r.sender.email}</span>
            <span><RqIcon name="clock" />{when(r.email.receivedAt)}</span>
          </div>
        </div>
        <StatusPill request={r} />
      </div>

      <div className="rq-grid">
        <div>
          <div className="card rq-progress">
            <div>
              <h2>{allDone ? "Everything’s in place" : `${3 - done} ${3 - done === 1 ? "thing stops" : "things stop"} this order from shipping`}</h2>
              <p className="muted">
                {done} resolved{covered > done ? ` · ${covered - done} will be asked in a reply` : ""}
              </p>
            </div>
            <div className="rq-meter" role="img" aria-label={`${done} of 3 resolved`}>
              {states.map((s, i) => (
                <i key={i} className={s === "done" ? "on" : s === "asked" ? "asked" : undefined} />
              ))}
            </div>
            {!allDone && covered < 3 && (
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => update((e) => ({ ...e, ask: Object.fromEntries(ASK_KEYS.map((k) => [k, !r.resolved[k]])), askAt: new Date().toISOString() }))}>
                Ask customer for the rest
              </button>
            )}
          </div>

          {edits.answered && (
            <p className="rq-note" role="status">
              <RqIcon name="checkCircle" />
              <span>
                <b>{(r.customer ?? r.sender.name).split(/\s+/)[0]} answered in the portal {when(edits.answered.at)}.</b> Their answers are filled in below.
                {Object.entries(edits.answered.lines ?? {}).map(([key, said]) => (
                  <span key={key} className="rq-sub">
                    For “{r.lines.find((l) => l.key === key)?.asked ?? "an item"}” they meant: {said}
                  </span>
                ))}
                {edits.answered.note && <span className="rq-sub">Note: {edits.answered.note}</span>}
              </span>
            </p>
          )}

          {task(
            "product",
            1,
            "Match the products",
            unmatched.length ? `${unmatched.map((l) => `“${l.asked}”`).join(", ")} ${unmatched.length === 1 ? "isn’t" : "aren’t"} in the catalogue, so there’s no stock to check.` : r.lines.length ? "Every item matches the catalogue." : "No product was found in the email.",
            productBody,
            "Needed to check stock",
          )}
          {task("qty", 2, "Confirm the quantity", noQty.length ? (r.email.quantityWarnings?.join(". ") || "No number was given in the email.") : "Quantities are set.", qtyBody, "Needed for the pick list")}
          {task(
            "address",
            3,
            "Add a shipping address",
            gaps.length === 4 ? "No address was given, so the destination region is unknown." : gaps.length ? `Missing the ${gaps.map((g) => ({ street: "street", city: "city", region: "state", postal: "postal code" })[g]).join(" and ")}.` : "Address is complete.",
            addressBody,
            "Needed to pick a warehouse",
          )}

          {plan && (
            <section className="card rq-task">
              <div className="rq-task-head">
                <span className={`rq-num ${routed ? "done" : ""}`}>{routed ? <RqIcon name="check" /> : 4}</span>
                <div>
                  <h3>Choose a warehouse</h3>
                  <p>{plan.suggested ? "The first one in the ranking with everything in stock is ticked." : "No warehouse has everything; tick more than one to split the order."}</p>
                </div>
              </div>
              <div className="rq-task-body">
                <ShipFrom
                  plan={plan}
                  picked={chosen}
                  disabled={!!routed}
                  onToggle={(w) => {
                    const next = new Set(chosen);
                    if (next.has(w)) next.delete(w);
                    else next.add(w);
                    setPicked(next);
                    // Ticking a warehouse other than the suggestion warns at once, as well as under the list.
                    const added = !chosen.has(w) && pickWarnings(plan, new Set([w]))[0];
                    if (added) toast.error(added, { id: "ship-from" });
                  }}
                />
              </div>
            </section>
          )}

          {(shortIds.length > 0 || edits.stockFlag) && (
            <StockFlagCard request={r} edits={edits} update={update} warehouses={stock.warehouses} shipFrom={shortIds.length ? shortIds : [...chosen]} />
          )}

          {showComposer && (
            <div ref={composer}>
              <ReplyComposer
                request={r}
                edits={edits}
                update={update}
                keys={asks}
                onToggle={(k) => setAsk(k, !ask(k))}
                options={open}
              />
            </div>
          )}

          <div className="card rq-actionbar">
            <span className="muted">
              {routed
                ? `Routed ${routed.auto ? "automatically " : routed.override ? "to a warehouse other than the suggestion " : ""}${when(routed.at)}.`
                : asks.length
                  ? `${asks.length} ${asks.length === 1 ? "question" : "questions"} ready for ${(r.customer ?? r.sender.name).split(/\s+/)[0]}`
                  : allDone
                    ? chosen.size
                      ? "Ready to route."
                      : "Tick a warehouse to route from."
                    : "Resolve each item or mark it to ask the customer."}
            </span>
            <div className="rq-acts">
              {routed ? (
                <button className="btn btn-quiet btn-sm" type="button" onClick={unroute}>
                  <RqIcon name="undo" />
                  Change warehouse
                </button>
              ) : showComposer ? (
                <Link className="btn btn-quiet btn-sm" href={`/portal/emails/${encodeURIComponent(r.email.id)}/reply`}>
                  Open thread
                </Link>
              ) : (
                <button className="btn btn-secondary" type="button" disabled={allDone} onClick={requestInfo}>
                  <RqIcon name="mail" />
                  Request info
                </button>
              )}
              <button className="btn btn-primary" type="button" disabled={!allDone || !chosen.size || !!routed} onClick={route}>
                {routed ? <><RqIcon name="check" />Routed</> : "Route order"}
              </button>
            </div>
          </div>
        </div>

        <aside>
          <div className="card rq-aside">
            <h4 className="rq-eyebrow">What we know</h4>
            <dl className="rq-kv">
              <dt>Customer</dt>
              <dd>{r.customer ?? <span className="rq-empty">Not given</span>}</dd>
              <dt>Reply to</dt>
              <dd>
                {r.contact.primary}
                {r.contact.secondary && <small className="rq-sub">Also {r.contact.secondary}, the sender</small>}
              </dd>
              <dt>Requested</dt>
              <dd>{r.lines.map((l) => `${l.asked}${l.quantity ? ` ×${l.quantity}` : ""}`).join(", ") || <span className="rq-empty">Nothing found</span>}</dd>
              <dt>Carrier</dt>
              <dd>
                {r.email.carrier ? (
                  <>
                    Carrier {r.email.carrier.carrier}
                    <small className="rq-sub">{carrierStatus(r.email.carrier)}</small>
                  </>
                ) : (
                  <span className="rq-empty">Not assigned yet</span>
                )}
              </dd>
              <dt>Delivery</dt>
              <dd>
                {deliveryDay(r.email.expectedDelivery.date)}
                <small className="rq-sub">{deliveryReason(r.email.expectedDelivery)}</small>
              </dd>
              <dt>Ref</dt>
              <dd className="mono">{r.ref}</dd>
              {r.score !== null && (
                <>
                  <dt>Agent score</dt>
                  <dd className="mono">{pct(r.score)}</dd>
                </>
              )}
            </dl>
            {r.customer && r.customer !== r.sender.name && (
              <p className="rq-note">
                <RqIcon name="info" />
                <span>
                  Sent from {r.sender.name}’s address but signed {r.customer}.{" "}
                  {r.contact.fromBody ? `Replies go to ${r.contact.primary}, given in the email, with the sender copied.` : "Replies go to the sender."}
                </span>
              </p>
            )}
          </div>
          <ClientCard request={r} disabled={!!routed} onChange={(clientId) => update((e) => ({ ...e, clientId }))} />
          <div className="card rq-aside">
            <h4 className="rq-eyebrow">Progress</h4>
            <ol className="rq-steps">
              {pipeline.map(([s, t, d]) => (
                <li key={t}>
                  <span className={`sd ${s}`}>{s === "ok" && <RqIcon name="check" />}</span>
                  <div>
                    {t}
                    <small>{d}</small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="card rq-aside">
            <button className="rq-disclosure" type="button" aria-expanded={emailOpen} onClick={() => setEmailOpen((o) => !o)}>
              <span className="rq-eyebrow">{api ? "Order as sent" : "Original email"}</span>
              <RqIcon name="chevron" className="caret" />
            </button>
            {emailOpen && <pre className="rq-email">{r.email.body ?? r.email.snippet}</pre>}
          </div>
          <div className="card rq-aside">
            <button className="rq-disclosure" type="button" aria-expanded={aiOpen} onClick={() => setAiOpen((o) => !o)}>
              <span className="rq-eyebrow">Agent response</span>
              <RqIcon name="chevron" className="caret" />
            </button>
            {aiOpen &&
              (r.email.aiResult ? (
                <>
                  <p className="rq-faint">
                    {r.email.aiResult.agent}
                    {r.email.aiReadAt && ` · ${when(r.email.aiReadAt)}`}
                  </p>
                  {typeof r.email.aiResult.output === "string" && (
                    <p className="rq-note warn">
                      <RqIcon name="alert" />
                      <span>
                        {jsonOf(r.email.aiResult.output) !== null
                          ? "The agent’s reply wasn’t valid JSON. Halcyon repaired it to read the order, so check the details above against it."
                          : "The agent replied in plain text, so nothing could be read from it."}
                      </span>
                    </p>
                  )}
                  <pre className="rq-email">
                    {typeof r.email.aiResult.output === "string" ? r.email.aiResult.output : JSON.stringify(r.email.aiResult.output, null, 2)}
                  </pre>
                </>
              ) : (
                <p className="muted">The agent hasn’t read this email yet.</p>
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// Catalogue search for an item the agent couldn't match: type to filter by name or SKU, pick one to map it.
function ProductPicker({ catalogue, initial, onPick }: { catalogue: Product[]; initial: string; onPick: (p: Product) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  // Before typing, suggest by the words of what was asked for.
  const words = initial.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const matches = q
    ? catalogue.filter((c) => `${c.productName} ${c.sku}`.toLowerCase().includes(q))
    : [...catalogue].sort((a, b) => score(b) - score(a));
  function score(p: Product) {
    const name = p.productName.toLowerCase();
    return words.filter((w) => name.includes(w)).length;
  }
  const shown = matches.slice(0, 8);

  return (
    <div
      className="rq-combo"
      ref={wrap}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <input
        className="input"
        placeholder="Search the catalogue"
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open && (
        <div className="rq-pop" id={listId} role="listbox">
          {shown.length ? (
            shown.map((c) => (
              <button
                key={c.productId}
                className="rq-opt"
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setOpen(false);
                  onPick(c);
                }}
              >
                <span>
                  {c.productName}
                  <small className="mono">{c.sku}</small>
                </span>
                <small>
                  ${c.unitPriceUsd.toFixed(2)} · {totalAvailable(c).toLocaleString("en-US")} in stock
                </small>
              </button>
            ))
          ) : (
            <div className="rq-pop-empty">Nothing in the catalogue matches “{query}”.</div>
          )}
          <div className="rq-pop-foot">
            Showing {shown.length} of {matches.length} {q ? "matches" : "items"}
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onChange, label, disabled }: { value: number | null; onChange: (q: number | null) => void; label: string; disabled?: boolean }) {
  return (
    <div className="rq-stepper">
      <button type="button" aria-label="Decrease" disabled={disabled || !(value && value > 1)} onClick={() => onChange(Math.max(1, (value ?? 1) - 1))}>
        <RqIcon name="minus" />
      </button>
      <input
        inputMode="numeric"
        value={value ?? ""}
        placeholder="–"
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value.replace(/\D/g, ""), 10);
          onChange(n > 0 ? n : null);
        }}
      />
      <button type="button" aria-label="Increase" disabled={disabled} onClick={() => onChange((value ?? 0) + 1)}>
        <RqIcon name="plus" />
      </button>
    </div>
  );
}
