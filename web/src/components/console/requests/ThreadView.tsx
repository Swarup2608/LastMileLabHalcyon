"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ASK_KEYS, initials, when, type AskKey, type OrderRequest } from "@/lib/order-request";
import ReplyComposer from "./ReplyComposer";
import { PageState, StatusPill, useRequestPage } from "./ResolveView";
import RqIcon from "./RqIcon";

type Source = "customer" | "product" | "qty" | "address" | "email";

// The Thread screen: the email as received, with what the agent read from it highlighted and listed beside it, and a
// reply that asks the customer for what's missing.
export default function ThreadView({ id }: { id: string }) {
  const { request, edits, update, error } = useRequestPage(id);
  const [chips, setChips] = useState<Set<AskKey> | null>(null);
  const [hl, setHl] = useState<Source | "">("");

  if (!request) return <PageState error={error} />;

  const r = request;
  // Start from what Resolve marked to ask, else everything still open.
  const marked = ASK_KEYS.filter((k) => edits.ask?.[k] && !r.resolved[k]);
  const selected = chips ?? new Set(marked.length ? marked : ASK_KEYS.filter((k) => !r.resolved[k]));
  const list = ASK_KEYS.filter((k) => selected.has(k));

  const toggle = (k: AskKey) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChips(next);
  };

  const gaps = (["street", "city", "region", "postal"] as const).filter((k) => !r.address[k].trim());
  const shipTo = [r.address.street, r.address.suite, r.address.city, r.address.region, r.address.postal, r.address.country].filter(Boolean).join(", ");

  return (
    <div className="rq">
      <div className="rq-head">
        <div className="rq-crumb">
          <Link href="/portal/emails">Order requests</Link>
          <RqIcon name="chevR" />
          <Link className="mono" href={`/portal/emails/${encodeURIComponent(r.email.id)}`}>{r.ref}</Link>
          <RqIcon name="chevR" />
          <span>Thread</span>
        </div>
        <StatusPill request={r} />
      </div>

      <div
        className="rq-thread"
        data-hl={hl || undefined}
        onPointerOver={(e) => setHl(((e.target as HTMLElement).closest("[data-hover]") as HTMLElement | null)?.dataset.hover as Source ?? "")}
        onPointerLeave={() => setHl("")}
      >
        <div>
          <article className="card rq-mail">
            <h1 className="rq-mail-subj">{r.email.subject || "(no subject)"}</h1>
            <div className="rq-mail-head">
              <span className="rq-av lg">{initials(r.sender.name)}</span>
              <div>
                <b>{r.sender.name}</b>{" "}
                <span className="rq-faint">
                  &lt;{r.contact.fromBody ? r.sender.email : <mark data-src="email" data-hover="email">{r.sender.email}</mark>}&gt;
                </span>
                <div className="rq-faint">to Halcyon · {when(r.email.receivedAt)}</div>
              </div>
            </div>
            <div className="rq-mail-body">{highlight(r.email.body ?? r.email.snippet, needlesOf(r))}</div>
          </article>

          <ReplyComposer request={r} edits={edits} update={update} keys={list} onToggle={toggle} />
        </div>

        <aside className="card rq-ex">
          <h4 className="rq-eyebrow">Read from this email</h4>
          <dl>
            <ExRow f="customer" ok={!!r.customer} label="Customer" value={r.customer ?? <span className="rq-empty">Not given</span>} sub={r.customer && r.customer !== r.sender.name ? `Sender name differs: ${r.sender.name}` : undefined} />
            <ExRow
              f="email"
              ok
              label="Reply to"
              value={r.contact.primary}
              sub={r.contact.fromBody ? `Given in the email · sender ${r.contact.secondary} is copied` : "The sender’s address"}
            />
            {r.lines.map((l) => (
              <ExRow
                key={`p${l.key}`}
                f="product"
                ok={!!l.product || l.declined}
                label="Product"
                value={l.asked}
                sub={l.product ? `Matches ${l.product.productName} (${l.product.sku})` : l.declined ? "Declined" : "No catalogue match, so no stock to check"}
              />
            ))}
            {r.lines
              .filter((l) => !l.declined)
              .map((l) => (
                <ExRow
                  key={`q${l.key}`}
                  f="qty"
                  ok={!!l.quantity}
                  label="Quantity"
                  value={l.quantity ? String(l.quantity) : <span className="rq-empty">Not stated</span>}
                  sub={r.lines.length > 1 ? l.asked : undefined}
                />
              ))}
            {shipTo && <ExRow f="address" ok={!gaps.length} label="Ship to" value={shipTo} sub={gaps.length ? `Missing the ${gaps.map((g) => ({ street: "street", city: "city", region: "state", postal: "postal code" })[g]).join(" and ")}` : undefined} />}
          </dl>
          {(!r.lines.length || !shipTo) && (
            <>
              <div className="rq-sep" />
              <h4 className="rq-eyebrow">Not in the email</h4>
              <dl>
                {!r.lines.length && <ExRow f="product" ok={false} label="Product" value={<span className="rq-empty">What they’d like to order</span>} sub="Stock check waits on this" />}
                {!shipTo && <ExRow f="address" ok={false} label="Ship to" value={<span className="rq-empty">Street, city, state, postal code</span>} sub="Warehouse choice waits on this" />}
              </dl>
            </>
          )}
          <p className="rq-note">
            <RqIcon name="info" />
            <span>Hover a field to see where it came from.</span>
          </p>
        </aside>
      </div>
    </div>
  );
}

function ExRow({ f, ok, label, value, sub }: { f: Source; ok: boolean; label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rq-ex-row" data-f={f} data-hover={f}>
      <span className={`st ${ok ? "ok" : "warn"}`}>
        <RqIcon name={ok ? "checkCircle" : "alert"} />
      </span>
      <dt>{label}</dt>
      <dd>
        {value}
        {sub && <small>{sub}</small>}
      </dd>
    </div>
  );
}

// What to mark in the email body, longest first so "12 Main St" wins over "Main".
function needlesOf(r: OrderRequest): [string, Source][] {
  const n: [string, Source][] = [];
  if (r.customer) n.push([r.customer, "customer"]);
  if (r.contact.fromBody) n.push([r.contact.primary, "email"]);
  for (const l of r.lines) {
    n.push([l.asked, "product"]);
    if (l.quantity) n.push([`${l.quantity} ${l.asked}`, "qty"]);
  }
  for (const v of [r.address.street, r.address.city, r.address.postal]) if (v) n.push([v, "address"]);
  return n.filter(([s]) => s.trim().length > 1).sort((a, b) => b[0].length - a[0].length);
}

// The body with each needle's first occurrences wrapped in <mark>, case-insensitively, never overlapping.
function highlight(body: string, needles: [string, Source][]): ReactNode[] {
  const lower = body.toLowerCase();
  const hits: { start: number; end: number; src: Source }[] = [];
  for (const [needle, src] of needles) {
    const n = needle.toLowerCase();
    for (let at = lower.indexOf(n); at !== -1; at = lower.indexOf(n, at + n.length)) {
      const end = at + n.length;
      if (!hits.some((h) => at < h.end && end > h.start)) hits.push({ start: at, end, src });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = 0;
  hits.forEach((h, i) => {
    if (h.start > pos) out.push(body.slice(pos, h.start));
    out.push(
      <mark key={i} data-src={h.src} data-hover={h.src}>
        {body.slice(h.start, h.end)}
      </mark>,
    );
    pos = h.end;
  });
  out.push(body.slice(pos));
  return out;
}
