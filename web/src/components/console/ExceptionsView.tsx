"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { refreshInbox, useStaffInbox } from "@/lib/inbox";
import { when } from "@/lib/order-request";
import { GROUP_OF, emailExceptions, type EmailException, type EmailExceptionKind, type ExceptionGroup } from "./requests/emailExceptions";
import RqIcon from "./requests/RqIcon";
import { useStaffRequests } from "./requests/useEmailedRows";

const KIND: Record<EmailExceptionKind, { label: string; chip: string; action: string }> = {
  address: { label: "Address", chip: "warn", action: "Resolve" },
  product: { label: "Not in catalogue", chip: "warn", action: "Resolve" },
  qty: { label: "No quantity", chip: "warn", action: "Resolve" },
  stock: { label: "Stock short", chip: "bad", action: "Split" },
  answered: { label: "Customer answered", chip: "ok", action: "Review" },
  stale: { label: "No reply in a day", chip: "warn", action: "Chase" },
};
const TYPE = { email: "EMAIL", edi: "EDI", api: "API", portal: "PORTAL" } as const;

// Each card: its title, icon, and what an empty card means.
const GROUPS: [ExceptionGroup, string, "alert" | "box" | "mail", string][] = [
  ["address", "Address issues", "alert", "Every order has a complete address, or the customer has been asked."],
  ["product", "Product issues", "box", "Every item matches the catalogue, has a quantity and is in stock."],
  ["email", "Email issues", "mail", "No customer is waiting on us, and none is over a day late replying."],
];

const CLIP: React.CSSProperties = { display: "block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// A card's one-line state under its header, in place of a table.
const LINE: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, margin: 0, padding: "0 20px 16px", fontSize: 14, lineHeight: "20px" };

// One row of a card: an emailed request (real, from the API). The simulation's exceptions are on the Simulation page.
interface IssueRow {
  key: string;
  ref: string;
  items: string;
  type: string;
  issue: string;
  chip: string;
  who: string;
  whoSub: string;
  detail: string;
  // Epoch ms.
  since: number;
  action: ReactNode;
}

function fromEmail({ kind, request: r, since, detail }: EmailException): IssueRow {
  return {
    key: `mail-${r.email.id}`,
    ref: r.ref,
    items: r.lines.map((l) => l.product?.productName ?? l.asked).join(", "),
    type: TYPE.email,
    issue: KIND[kind].label,
    chip: KIND[kind].chip,
    who: r.customer ?? r.sender.name,
    whoSub: r.contact.primary,
    detail,
    since: new Date(since).getTime(),
    action: (
      <Link className="btn btn-secondary btn-sm" href={`/portal/emails/${encodeURIComponent(r.email.id)}${kind === "stale" ? "/reply" : ""}`}>
        {KIND[kind].action}
      </Link>
    ),
  };
}

// "12s ago", for the live indicator.
const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
};

// The staff Exceptions page: its header, then a card per issue (address, product, email) with every real order that
// needs a person, live from the inbox (every 15 seconds). Each order sits in one card. Simulated exceptions are only on
// the Simulation page.
export default function ExceptionsView() {
  const inbox = useStaffInbox();
  const { requests, stock, edits } = useStaffRequests(true);
  // Re-renders the "updated …" line and lets "No reply in a day" appear without a new poll.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const list = requests && stock ? emailExceptions(requests, (id) => edits[id] ?? {}, stock.products, stock.warehouses, now) : null;
  const rowsOf = (group: ExceptionGroup): IssueRow[] | null => {
    if (!list) return null;
    const mail = list.filter((x) => GROUP_OF[x.kind] === group).map(fromEmail);
    // Address issues: oldest first. The others keep emailExceptions' order (most urgent kind first).
    return group === "address" ? mail.sort((a, b) => a.since - b.since) : mail;
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Exceptions</h1>
          <p>Orders that need a person, by what’s wrong. Address issues first, because they block picking.</p>
        </div>
        <div className="acts" style={{ alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">
            {inbox.failed ? "Couldn’t reach the inbox" : inbox.at ? `Live · updated ${ago(inbox.at)}` : "Connecting…"}
          </span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={refreshInbox}>
            Refresh
          </button>
        </div>
      </div>

      {/* minmax(0, 1fr): a wide table scrolls inside its card instead of widening every card past the page. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 24, marginBottom: 24 }}>
        {GROUPS.map(([group, title, icon, clear]) => (
          <IssueCard key={group} title={title} icon={icon} clear={clear} rows={rowsOf(group)} />
        ))}
      </div>
    </>
  );
}

function IssueCard({ title, icon, clear, rows }: { title: string; icon: "alert" | "box" | "mail"; clear: string; rows: IssueRow[] | null }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-h">
        <RqIcon name={icon} />
        {title}
        <span className="r">
          {rows && (rows.length ? <span className="chip warn">{rows.length}</span> : <span className="chip ok">All clear</span>)}
        </span>
      </div>
      {!rows ? (
        <p className="muted" style={LINE} aria-busy="true">Loading the inbox…</p>
      ) : !rows.length ? (
        <p className="muted" style={LINE}>
          <RqIcon name="checkCircle" />
          {clear}
        </p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Order</th>
                <th>Type</th>
                <th>Issue</th>
                <th>Customer</th>
                <th>What’s wrong</th>
                <th>Since</th>
                <th><span className="sr">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="id">{row.ref}</span>
                    {row.items && <span className="sub" style={CLIP} title={row.items}>{row.items}</span>}
                  </td>
                  <td><span className="chip ch">{row.type}</span></td>
                  <td><span className={`chip ${row.chip}`}>{row.issue}</span></td>
                  <td>
                    {row.who}
                    <span className="sub" style={CLIP} title={row.whoSub}>{row.whoSub}</span>
                  </td>
                  <td className="wrap">{row.detail}</td>
                  <td className="mono">{when(new Date(row.since).toISOString())}</td>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
