"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { deliveryDay, deliveryReason } from "@/lib/settings";
import { useConsoleUser } from "./ConsoleShell";
import { clientStatus, messagesOf, needsClient, orderPath, useClientRequests, warehouseNameIn } from "./requests/ClientRequests";
import { useEmailedRows } from "./requests/useEmailedRows";

const CHIP = { ok: "ok", warn: "warn", info: "blue", neutral: "" } as const;

// The client's home page, from their real orders only: what needs their input first, then their latest orders.
export default function ClientHome() {
  const user = useConsoleUser();
  const { requests, stock, failed } = useClientRequests();
  const rows = useEmailedRows("client");

  const waiting = requests && stock ? requests.filter(needsClient) : null;
  const latest = rows ? [...rows].sort((a, b) => b.arrival - a.arrival).slice(0, 6) : null;
  const name = stock ? warehouseNameIn(stock) : (id: string) => id;

  return (
    <>
      <div className="page-h">
        <div>
          <p className="kick">{user.client?.clientName ?? "Your account"}</p>
          <h1>Home</h1>
          <p>What needs your input, and your latest orders.</p>
        </div>
        <div className="acts">
          <Link className="btn btn-secondary" href="/portal/orders">
            <Icon name="package" />
            All orders
          </Link>
          <Link className="btn btn-cta" href="/portal/orders/new">
            <Icon name="plus" />
            New order
          </Link>
        </div>
      </div>

      {failed && (
        <div className="card empty" role="alert" style={{ marginBottom: 16 }}>
          We couldn’t load your orders. Refresh the page to try again.
        </div>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <Icon name="warning" />
          Needs your input
        </div>
        {!waiting ? (
          <div className="empty" aria-busy="true">Loading…</div>
        ) : !waiting.length ? (
          <div className="empty">
            <Icon name="check-circle" className="lg" />
            Nothing needs your input. We’ll let you know here if an order does.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: "0 20px 16px", display: "grid", gap: 12 }}>
            {waiting.map((r) => {
              const ask = [...messagesOf(r, name)].reverse().find((m) => m.kind === "warn");
              const status = clientStatus(r, name);
              return (
                <li key={r.email.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <span className={`chip ${CHIP[status.tone]}`}>{status.label}</span>
                  <span style={{ flex: "1 1 320px" }}>
                    <strong className="mono">{r.ref}</strong> · {ask?.text ?? "Open the order to see what’s needed."}
                  </span>
                  <Link className="btn btn-primary btn-sm" href={orderPath(r)}>
                    Open order
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-h">
          <Icon name="package" />
          Latest orders
          <span className="r">
            <Link href="/portal/orders">All orders</Link>
          </span>
        </div>
        {!latest ? (
          <div className="empty" aria-busy="true">Loading…</div>
        ) : !latest.length ? (
          <div className="empty">
            <Icon name="package" className="lg" />
            No orders yet. <Link href="/portal/orders/new">Place your first order</Link>.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Expected delivery</th>
                  <th>Products</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="id" href={r.href}>
                        {r.id}
                      </Link>
                    </td>
                    <td>
                      <span className={`chip ${CHIP[r.tone]}`}>{r.status}</span>
                    </td>
                    <td>
                      {deliveryDay(r.delivery.date)}
                      <span className="sub">{deliveryReason(r.delivery)}</span>
                    </td>
                    <td>{r.items || <span className="muted">Not given yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
