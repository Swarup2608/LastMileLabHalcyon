"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { messagesOf, orderPath, useClientRequests, warehouseNameIn } from "./requests/ClientRequests";

const CHIP = { "": "", ok: "ok", warn: "warn" } as const;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The client's messages: every update Halcyon has given them on their real orders, newest first. The header bell shows
// a dot while any order needs their input. Answering happens on the order itself.
export default function ClientMessagesView() {
  const { requests, stock, failed } = useClientRequests();
  const name = stock ? warehouseNameIn(stock) : (id: string) => id;
  const items =
    requests && stock
      ? requests
          .flatMap((r) => messagesOf(r, name).map((m) => ({ ...m, ref: r.ref, href: orderPath(r) })))
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      : null;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Messages</h1>
          <p>Updates on your orders. Questions and new delivery dates are answered on the order itself.</p>
        </div>
      </div>
      <section className="card">
        {failed ? (
          <div className="empty" role="alert">
            We couldn’t load your messages. Refresh the page to try again.
          </div>
        ) : !items ? (
          <div className="empty" aria-busy="true">Loading…</div>
        ) : !items.length ? (
          <div className="empty">
            <Icon name="bell" className="lg" />
            No messages yet. Updates on your orders appear here.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 16, display: "grid", gap: 12 }}>
            {items.map((m, i) => (
              <li key={`${m.ref}-${i}`} style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <span className="mono muted" style={{ fontSize: 12, minWidth: 128 }}>
                  {when(m.at)}
                </span>
                <span style={{ flex: "1 1 320px" }}>
                  <Link className="id" href={m.href}>
                    {m.ref}
                  </Link>{" "}
                  {m.kind && <span className={`chip ${CHIP[m.kind]}`}>{m.kind === "warn" ? "Needs you" : "Update"}</span>} {m.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
