"use client";

import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import { ApiError } from "@/lib/api";
import { orderRequestsApi, type RequestAnswers } from "@/lib/emails";
import { ADDRESS_REQUIRED, questionsFor, when, type Address, type OrderRequest } from "@/lib/order-request";
import type { Product } from "@/lib/products";
import { carrierStatus } from "@/lib/carrier-plan";
import { deliveryDay, deliveryReason } from "@/lib/settings";
import { clientStatus, itemsOf, questionsOf, shipToOf, useClientRequests } from "./ClientRequests";
import RqIcon from "./RqIcon";

const ADDRESS_FIELDS: [keyof Address, string, string][] = [
  ["street", "Street", "c4"],
  ["suite", "Suite or unit (optional)", "c2"],
  ["city", "City", "c2"],
  ["region", "State", "c2"],
  ["postal", "Postal code", "c2"],
  ["country", "Country (optional)", "c6"],
];

// The client's page for one emailed order (/portal/orders/REQ-…): what Halcyon read from the email, where it stands,
// and, when Halcyon asked for something, inputs for exactly that. Answers save to the request as if staff typed them.
export default function ClientOrderView({ refId }: { refId: string }) {
  const { requests, stock, failed, reload } = useClientRequests();
  const r = requests?.find((x) => x.ref === refId);

  if (failed || (requests && !r))
    return (
      <div className="card empty" role="alert">
        <RqIcon name="alert" className="lg" />
        {failed ? "We couldn’t load this order from Halcyon." : "We couldn’t find this order among yours."}
        <Link className="btn btn-secondary btn-sm" href="/portal/orders">Back to orders</Link>
      </div>
    );
  if (!r || !stock) return <div className="card empty" aria-busy="true">Loading the order…</div>;

  const name = (id: string) => stock.warehouses.find((w) => w.warehouseId === id)?.warehouseName ?? id;
  const status = clientStatus(r, name);
  const asks = questionsOf(r);
  const edits = r.email.edits ?? {};
  const api = r.email.channel === "api";

  return (
    <div className="rq">
      <div className="rq-head">
        <div>
          <div className="rq-crumb">
            <Link href="/portal/orders">Orders</Link>
            <RqIcon name="chevR" />
            <span className="mono">{r.ref}</span>
          </div>
          <h1 className="rq-title">{itemsOf(r) || r.email.subject || (api ? "API order" : "Emailed order")}</h1>
          <div className="rq-meta">
            <span><RqIcon name="mail" />{api ? "Placed through the API" : "Emailed"} {when(r.email.receivedAt)}</span>
          </div>
        </div>
        <span className={`rq-pill ${status.tone}`}><span className="dot" />{status.label}</span>
      </div>

      <div className="rq-grid">
        <div>
          {edits.stockFlag?.status === "pending" && <NewDateCard key={edits.stockFlag.at} request={r} onDone={reload} />}
          {asks.length > 0 ? (
            <AnswerForm key={asks.join()} request={r} catalogue={stock.products} onDone={reload} />
          ) : edits.answered && r.status !== "routed" ? (
            <div className="card rq-progress">
              <div>
                <h2>Thanks, we have your answers</h2>
                <p className="muted">Sent {when(edits.answered.at)}. We’re checking them and will route the order.</p>
              </div>
            </div>
          ) : null}

          <section className="card rq-task">
            <div className="rq-task-head">
              <span className={`rq-num ${r.status === "routed" ? "done" : ""}`}>{r.status === "routed" ? <RqIcon name="check" /> : <RqIcon name="box" />}</span>
              <div>
                <h3>Your order</h3>
                <p>{api ? "As you placed it" : "What we read from your email"}{edits.answered ? " and your answers" : ""}.</p>
              </div>
            </div>
            <div className="rq-task-body">
              <dl className="rq-kv">
                <dt>Items</dt>
                <dd>
                  {r.lines.length
                    ? r.lines.map((l) => (
                        <span key={l.key} className="rq-dd-line">
                          {l.product?.productName ?? l.asked}
                          {l.product && <small className="rq-faint mono"> {l.product.sku}</small>}
                          {" "}
                          {l.declined ? <span className="rq-pill neutral">Not available</span> : l.quantity ? `×${l.quantity}` : <span className="rq-empty">quantity not given</span>}
                        </span>
                      ))
                    : <span className="rq-empty">Not given</span>}
                </dd>
                <dt>Ship to</dt>
                <dd>{shipToOf(r) || <span className="rq-empty">Not given</span>}</dd>
                <dt>Ships from</dt>
                <dd>{edits.routed ? edits.routed.warehouseIds.map(name).join(" and ") : <span className="rq-empty">Chosen once everything’s in</span>}</dd>
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
              </dl>
            </div>
          </section>
        </div>

        <aside>
          <div className="card rq-aside">
            <h4 className="rq-eyebrow">{api ? "Your order as sent" : "Your email"}</h4>
            <p className="rq-faint">{r.email.subject || "(no subject)"} · {when(r.email.receivedAt)}</p>
            <pre className="rq-email">{r.email.body ?? r.email.snippet}</pre>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Inputs for what Halcyon asked: the shipping address, a quantity per item, the product for items not matched to the
// client's catalogue (picked from it, or described), and a note.
function AnswerForm({ request: r, catalogue, onDone }: { request: OrderRequest; catalogue: Product[]; onDone: () => void }) {
  const asks = questionsOf(r);
  const [address, setAddress] = useState<Address>(r.address);
  const live = r.lines.filter((l) => !l.declined);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(live.map((l) => [l.key, l.quantity ? String(l.quantity) : ""])));
  const unmatched = live.filter((l) => !l.product);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [described, setDescribed] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const missingAddress = asks.includes("address") ? ADDRESS_REQUIRED.filter((k) => !address[k].trim()) : [];
  const badQty = asks.includes("qty") ? live.filter((l) => !(Number.parseInt(qty[l.key] ?? "", 10) > 0)) : [];
  const noProduct = asks.includes("product") ? unmatched.filter((l) => !picked[l.key] && !described[l.key]?.trim()) : [];
  const ready = !missingAddress.length && !badQty.length && !noProduct.length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const body: RequestAnswers = { ...(note.trim() ? { note: note.trim() } : {}) };
    if (asks.includes("address")) body.address = Object.fromEntries(Object.entries(address).map(([k, v]) => [k, v.trim()]));
    const lines: NonNullable<RequestAnswers["lines"]> = {};
    if (asks.includes("qty")) for (const l of live) lines[l.key] = { quantity: Number.parseInt(qty[l.key], 10) };
    if (asks.includes("product"))
      for (const l of unmatched)
        lines[l.key] = { ...lines[l.key], ...(picked[l.key] ? { productId: picked[l.key] } : { note: described[l.key].trim() }) };
    if (Object.keys(lines).length) body.lines = lines;

    setBusy(true);
    try {
      await orderRequestsApi.answer(r.email.id, body);
      toast.success("Thanks, we’ve sent your answers to Halcyon");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 400 ? err.reasons() : "We couldn’t send your answers. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card rq-task" onSubmit={submit}>
      <div className="rq-task-head">
        <span className="rq-num asked"><RqIcon name="mail" /></span>
        <div>
          <h3>Halcyon needs a few details</h3>
          <p>{questionsFor(r, asks).join(" ")}</p>
        </div>
      </div>
      <div className="rq-task-body">
        {asks.includes("product") && unmatched.length > 0 && (
          <div className="rq-lines" style={{ marginBottom: 16 }}>
            {unmatched.map((l) => (
              <div key={l.key} className="rq-match">
                <span className="rq-label">Which product did you mean by “{l.asked}”?</span>
                <div className="rq-match-row">
                  <select
                    className="select"
                    aria-label={`Product for ${l.asked}`}
                    value={picked[l.key] ?? ""}
                    onChange={(e) => setPicked((p) => ({ ...p, [l.key]: e.target.value }))}
                  >
                    <option value="">Pick from your catalogue</option>
                    {catalogue.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.productName} · {p.sku}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="Or describe it (brand, model or link)"
                    value={described[l.key] ?? ""}
                    disabled={!!picked[l.key]}
                    onChange={(e) => setDescribed((d) => ({ ...d, [l.key]: e.target.value }))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {asks.includes("qty") && live.length > 0 && (
          <div className="rq-lines" style={{ marginBottom: 16 }}>
            {live.map((l) => (
              <div key={l.key} className="rq-qty-row">
                <input
                  className="input"
                  inputMode="numeric"
                  style={{ width: 96 }}
                  aria-label={`How many ${l.product?.productName ?? l.asked}`}
                  placeholder="Qty"
                  value={qty[l.key] ?? ""}
                  aria-invalid={badQty.includes(l) || undefined}
                  onChange={(e) => setQty((q) => ({ ...q, [l.key]: e.target.value.replace(/\D/g, "") }))}
                />
                <span className="rq-faint">× {l.product?.productName ?? l.asked}</span>
              </div>
            ))}
          </div>
        )}

        {asks.includes("address") && (
          <div className="rq-addr" style={{ marginBottom: 16 }}>
            {ADDRESS_FIELDS.map(([k, label, cls]) => (
              <div key={k} className={cls}>
                <label className="rq-label" htmlFor={`ans-${k}`}>{label}</label>
                <input
                  id={`ans-${k}`}
                  className="input"
                  value={address[k]}
                  autoComplete={{ street: "address-line1", suite: "address-line2", city: "address-level2", region: "address-level1", postal: "postal-code", country: "country-name" }[k]}
                  aria-invalid={missingAddress.includes(k) || undefined}
                  onChange={(e) => setAddress((a) => ({ ...a, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        <label className="rq-label" htmlFor="ans-note">Anything else? (optional)</label>
        <textarea id="ans-note" className="textarea" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="rq-task-foot">
        <span className="rq-faint">
          {ready ? "Your answers go straight to Halcyon’s order team." : "Fill in each highlighted field to send."}
        </span>
        <button className="btn btn-primary" type="submit" disabled={!ready || busy} aria-busy={busy}>
          <RqIcon name="send" />
          {busy ? "Sending…" : "Send answers"}
        </button>
      </div>
    </form>
  );
}

// Halcyon flagged the order as out of stock and proposed a new delivery date: the message, and accept or decline.
function NewDateCard({ request: r, onDone }: { request: OrderRequest; onDone: () => void }) {
  const flag = r.email.edits!.stockFlag!;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const respond = async (decision: "accept" | "decline") => {
    setBusy(decision);
    try {
      await orderRequestsApi.respondStock(r.email.id, decision, note.trim() || undefined);
      toast.success(decision === "accept" ? `Thanks, your order now delivers on ${deliveryDay(flag.newDate)}` : "Thanks, we’ve told Halcyon’s order team");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 409 ? err.message : "We couldn’t send your answer. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card rq-task">
      <div className="rq-task-head">
        <span className="rq-num asked"><RqIcon name="alert" /></span>
        <div>
          <h3>New delivery date: {deliveryDay(flag.newDate)}</h3>
          <p>
            {flag.items.join(", ")} {flag.items.length === 1 ? "is" : "are"} out of stock, so this can’t arrive on {deliveryDay(flag.originalDate)}.
          </p>
        </div>
      </div>
      <div className="rq-task-body">
        <pre className="rq-email" style={{ whiteSpace: "pre-wrap" }}>{flag.message}</pre>
        <label className="rq-label" htmlFor="nd-note">Note for Halcyon (optional)</label>
        <input id="nd-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="rq-task-foot">
        <span className="rq-faint">Sent {when(flag.at)}</span>
        <div className="rq-acts">
          <button className="btn btn-secondary" type="button" disabled={!!busy} aria-busy={busy === "decline"} onClick={() => respond("decline")}>
            {busy === "decline" ? "Sending…" : "Decline"}
          </button>
          <button className="btn btn-primary" type="button" disabled={!!busy} aria-busy={busy === "accept"} onClick={() => respond("accept")}>
            <RqIcon name="check" />
            {busy === "accept" ? "Accepting…" : `Accept ${deliveryDay(flag.newDate)}`}
          </button>
        </div>
      </div>
    </section>
  );
}
