"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { ApiError } from "@/lib/api";
import { emailsApi } from "@/lib/emails";
import { decisionLines, when, type OrderRequest, type RequestEdits } from "@/lib/order-request";
import { deliveryDay } from "@/lib/settings";
import type { Warehouse } from "@/lib/warehouses";
import RqIcon from "./RqIcon";

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The warehouse turned out to be out of stock: staff flag it, pick what's short and a new delivery date, have the AI
// draft agent (or the template) write the message, edit it and send it. The client sees it on their order page and
// accepts or declines the new date; accepting moves the order's expected delivery to it.
export default function StockFlagCard({
  request: r,
  edits,
  update,
  warehouses,
  // The routed (or ticked) warehouses, first is the default.
  shipFrom,
}: {
  request: OrderRequest;
  edits: RequestEdits;
  update: (change: (e: RequestEdits) => RequestEdits) => void;
  warehouses: Warehouse[];
  shipFrom: string[];
}) {
  const flag = edits.stockFlag;
  const live = r.lines.filter((l) => l.product && !l.declined);
  const label = (l: (typeof live)[number]) => `${l.product!.productName}${l.quantity ? ` ×${l.quantity}` : ""}`;
  const originalDate = r.email.expectedDelivery.date;

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState(shipFrom[0] ?? warehouses[0]?.warehouseId ?? "");
  // Items short at that warehouse first; staff can tick others.
  const shortAt = (w: string) => live.filter((l) => (l.product!.stock.find((s) => s.warehouseId === w)?.available ?? 0) < (l.quantity ?? 1));
  const [items, setItems] = useState<string[]>(() => (shortAt(warehouseId).length ? shortAt(warehouseId) : live).map((l) => l.key));
  const [newDate, setNewDate] = useState(addDays(originalDate, 3));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [drafting, setDrafting] = useState(false);

  const warehouseName = (id: string) => warehouses.find((w) => w.warehouseId === id)?.warehouseName ?? id;
  const customer = r.customer ?? r.sender.name;
  const picked = live.filter((l) => items.includes(l.key));
  const dateOk = newDate > originalDate;

  const draft = async () => {
    setDrafting(true);
    try {
      const d = await emailsApi.stockDraft(r.email.id, {
        customer,
        ref: r.ref,
        items: picked.map(label),
        warehouse: warehouseName(warehouseId),
        originalDate,
        newDate,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setMessage(d.message);
      setSource(d.source);
      if (d.source === "template") toast("The AI draft agent isn’t set up on the API, so this draft is from the template.", { icon: "ℹ️" });
    } catch (err) {
      toast.error(err instanceof ApiError ? `Couldn’t draft the message: ${err.message}` : "We couldn’t reach Halcyon.");
    } finally {
      setDrafting(false);
    }
  };

  const send = () => {
    update((e) => ({
      ...e,
      stockFlag: {
        warehouseId,
        items: picked.map(label),
        lines: decisionLines(r, items),
        originalDate,
        newDate,
        message: message.trim(),
        source: source ?? "template",
        at: new Date().toISOString(),
        status: "pending",
      },
    }));
    setOpen(false);
    toast.success(`Sent to ${customer}. They can accept ${deliveryDay(newDate)} on their order page.`);
  };

  const head = (
    <div className="rq-task-head">
      <span className={`rq-num ${flag?.status === "accepted" ? "done" : flag ? "asked" : ""}`}>
        {flag?.status === "accepted" ? <RqIcon name="check" /> : <RqIcon name="alert" />}
      </span>
      <div>
        <h3>Out of stock at the warehouse?</h3>
        <p>Flag it to tell the customer and propose a new delivery date they can accept.</p>
      </div>
    </div>
  );

  if (flag)
    return (
      <section className="card rq-task">
        {head}
        <div className="rq-task-body">
          <p className={`rq-note ${flag.status === "accepted" ? "" : flag.status === "declined" ? "bad" : "warn"}`} role="status">
            <RqIcon name={flag.status === "accepted" ? "checkCircle" : "alert"} />
            <span>
              <b>
                {flag.status === "pending"
                  ? `Waiting on ${customer.split(/\s+/)[0]} to accept ${deliveryDay(flag.newDate)}`
                  : flag.status === "accepted"
                    ? `${customer.split(/\s+/)[0]} accepted ${deliveryDay(flag.newDate)} ${flag.respondedAt ? when(flag.respondedAt) : ""}`
                    : `${customer.split(/\s+/)[0]} declined ${deliveryDay(flag.newDate)} ${flag.respondedAt ? when(flag.respondedAt) : ""}`}
              </b>
              <span className="rq-sub">
                Flagged {when(flag.at)} · {warehouseName(flag.warehouseId)} short on {flag.items.join(", ")} · was due {deliveryDay(flag.originalDate)}
              </span>
              {flag.response && <span className="rq-sub">Their note: {flag.response}</span>}
            </span>
          </p>
          <details style={{ marginTop: 12 }}>
            <summary className="rq-faint" style={{ cursor: "pointer" }}>
              Message sent {flag.source === "ai" ? "(drafted by AI)" : "(from the template)"}
            </summary>
            <pre className="rq-email">{flag.message}</pre>
          </details>
        </div>
        {flag.status !== "accepted" && (
          <div className="rq-task-foot">
            <span className="rq-faint">{flag.status === "declined" ? "Propose another date, or route it elsewhere." : "Withdrawing hides it from the customer."}</span>
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => update((e) => ({ ...e, stockFlag: undefined }))}>
              <RqIcon name="undo" />
              {flag.status === "declined" ? "Clear and start over" : "Withdraw"}
            </button>
          </div>
        )}
      </section>
    );

  return (
    <section className="card rq-task">
      {head}
      {!open ? (
        <div className="rq-task-foot">
          <span className="rq-faint">Due {deliveryDay(originalDate)}</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={!live.length} onClick={() => setOpen(true)}>
            <RqIcon name="alert" />
            Flag out of stock
          </button>
        </div>
      ) : (
        <>
          <div className="rq-task-body rq-addr">
            <div className="c3">
              <label className="rq-label" htmlFor="sf-wh">Warehouse that’s short</label>
              <select
                id="sf-wh"
                className="select"
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  const short = shortAt(e.target.value);
                  setItems((short.length ? short : live).map((l) => l.key));
                }}
              >
                {warehouses.map((w) => (
                  <option key={w.warehouseId} value={w.warehouseId}>
                    {w.warehouseName ?? w.warehouseId}
                    {shipFrom.includes(w.warehouseId) ? " (shipping from)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="c3">
              <label className="rq-label" htmlFor="sf-date">New delivery date</label>
              <input id="sf-date" className="input" type="date" min={addDays(originalDate, 1)} value={newDate} aria-invalid={!dateOk || undefined} onChange={(e) => setNewDate(e.target.value)} />
              <span className="rq-faint">Was {deliveryDay(originalDate)}</span>
            </div>
            <fieldset className="c6" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="rq-label">Out of stock</legend>
              {live.map((l) => (
                <label key={l.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={items.includes(l.key)}
                    onChange={() => setItems((k) => (k.includes(l.key) ? k.filter((x) => x !== l.key) : [...k, l.key]))}
                  />
                  {label(l)}
                </label>
              ))}
            </fieldset>
            <div className="c6">
              <label className="rq-label" htmlFor="sf-reason">Note for the draft (optional)</label>
              <input id="sf-reason" className="input" maxLength={500} value={reason} placeholder="e.g. Restock arrives Monday" onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="c6">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span className="rq-label" style={{ margin: 0 }}>Message to {customer}</span>
                {source && <span className={`rq-pill ${source === "ai" ? "info" : "neutral"}`}>{source === "ai" ? "Drafted by AI" : "Template"}</span>}
                <button className="btn btn-secondary btn-sm" type="button" style={{ marginLeft: "auto" }} disabled={drafting || !picked.length || !dateOk} aria-busy={drafting} onClick={draft}>
                  <RqIcon name="mail" />
                  {drafting ? "Drafting…" : message ? "Redraft with AI" : "Draft with AI"}
                </button>
              </div>
              <textarea
                className="textarea"
                rows={9}
                aria-label={`Message to ${customer}`}
                placeholder="Draft it with AI, then edit before sending."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          </div>
          <div className="rq-task-foot">
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" type="button" disabled={!message.trim() || !picked.length || !dateOk} onClick={send}>
              <RqIcon name="send" />
              Send to customer
            </button>
          </div>
        </>
      )}
    </section>
  );
}
