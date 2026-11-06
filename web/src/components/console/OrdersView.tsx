"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import Pagination from "@/components/Pagination";
import { DEFAULT_PAGE_SIZE, clampPage } from "@/lib/pagination";
import { deliveryDay, deliveryReason } from "@/lib/settings";
import type { SimOrderRow } from "@/lib/portal/engine";
import { useConsoleUser, usePortalEngine } from "./ConsoleShell";
import { useEmailedRows, type EmailedRow } from "./requests/useEmailedRows";

type Channel = SimOrderRow["channel"];
const TYPE: Record<Channel, string> = {
  email: "EMAIL",
  edi: "EDI",
  api: "API",
  portal: "PORTAL",
};
const CHANNELS: [Channel, string][] = (["email", "edi", "api", "portal"] as const).map((k) => [k, TYPE[k]]);
// Emailed rows' tones in the engine's chip classes.
const CHIP = { ok: "ok", warn: "warn", info: "blue", neutral: "" } as const;

// One list row: a simulated order from the engine, or a real request from the API (emailed, or placed through it).
type Row = ({ kind: "sim" } & SimOrderRow) | ({ kind: "mail" } & EmailedRow);

type Status = "open" | "attn" | "done";
const STATUSES: [Status, string][] = [
  ["open", "In progress"],
  ["attn", "Needs attention"],
  ["done", "Delivered"],
];
const inStatus = (r: Row, s: Status) =>
  r.kind === "sim"
    ? s === "open"
      ? !r.delivered && !r.held
      : s === "attn"
        ? r.held || r.delayed
        : r.delivered
    : s === "open"
      ? !r.attn && !r.delivered
      : s === "attn"
        ? r.attn
        : r.delivered;

const products = (r: Row) => (r.kind === "sim" ? `${r.product} ×${r.qty}` : r.items);
const address = (r: Row) => (r.kind === "sim" ? r.address : r.shipTo);

// At most two items, then "+N more"; the cell also cuts a long line short. The full list is in the tooltip.
const trimItems = (items: string, max = 2) => {
  const parts = items.split(", ");
  return parts.length > max ? `${parts.slice(0, max).join(", ")} +${parts.length - max} more` : items;
};
const CLIP: React.CSSProperties = {
  display: "block",
  maxWidth: 280,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

// One orders table, newest first, filtered by status and type (none ticked means all). source "real" is the Orders page
// for both portals: real requests from the API (emailed, or placed through it); clients see their own, staff every
// client's, and each opens on its own page (the client's, or Resolve). source "sim" is the Simulation's Orders tab
// (admins): the engine's simulated orders only, opening on the Simulation's order page. The two never mix.
export default function OrdersView({ source = "real" }: { source?: "real" | "sim" }) {
  const sim = source === "sim";
  const user = useConsoleUser();
  const isClient = user.role === "client";
  const router = useRouter();
  const params = useSearchParams();
  const { engine } = usePortalEngine();
  const mail = useEmailedRows(isClient ? "client" : "staff");

  const [simRows, setSimRows] = useState<SimOrderRow[]>([]);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [types, setTypes] = useState<Channel[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // The simulation moves on its own; once a second is often enough for a list.
  useEffect(() => {
    if (!sim || !engine) return;
    const read = () => setSimRows(engine.orderRows());
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [sim, engine]);

  const q = query.trim().toLowerCase();
  const all: Row[] = (
    sim ? simRows.map((o): Row => ({ kind: "sim", ...o })) : (mail ?? []).map((r): Row => ({ kind: "mail", ...r }))
  ).sort((a, b) => b.arrival - a.arrival);
  const text = (r: Row) =>
    [r.id, r.client ?? "", products(r), address(r), r.channel, r.warehouse ?? ""].join(" ").toLowerCase();
  const byType = (r: Row) => !types.length || types.includes(r.channel);
  const byStatus = (r: Row) => !statuses.length || statuses.some((s) => inStatus(r, s));
  // Each dropdown counts what it would show with the other filter as it is.
  const searched = all.filter((r) => !q || text(r).includes(q));
  const typed = searched.filter(byType);
  const rows = typed.filter(byStatus);
  const current = clampPage(page, rows.length, pageSize);
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);

  const open = (r: Row) => router.push(r.kind === "sim" ? `/portal/simulation/orders/${encodeURIComponent(r.id)}` : r.href);
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <>
      <div className="page-h">
        <div>
          {isClient && <p className="kick">Shipments</p>}
          <h1>{sim ? "Simulated orders" : "Orders"}</h1>
          <p>
            {sim
              ? "Orders the simulation generates. They live in this browser only and never reach the real database."
              : isClient
                ? `Every order from ${user.client?.clientName ?? "you"}, however it was placed.`
                : "Every real order in one list. Email orders are read on arrival, not when someone keys them."}
          </p>
        </div>
        {isClient && !sim && (
          <div className="acts">
            <Link className="btn btn-cta" href="/portal/orders/new">
              <Icon name="plus" />
              New order
            </Link>
          </div>
        )}
      </div>

      <section className="card">
        <div className="toolbar">
          <MultiSelect
            label="Status"
            options={STATUSES.map(([k, l]) => [k, l, searched.filter(byType).filter((r) => inStatus(r, k)).length])}
            value={statuses}
            onChange={reset(setStatuses)}
          />
          <MultiSelect
            label="Type"
            options={CHANNELS.map(([k, l]) => [k, l, searched.filter(byStatus).filter((r) => r.channel === k).length])}
            value={types}
            onChange={reset(setTypes)}
          />
          <label className="searchbox">
            <span className="sr">Search orders</span>
            <Icon name="magnifying-glass" />
            <input
              className="input"
              placeholder={isClient ? "Order, product or address" : "Order, client, product or address"}
              value={query}
              onChange={(e) => reset(setQuery)(e.target.value)}
            />
          </label>
          <span className="muted" style={{ fontSize: 12, lineHeight: "16px" }}>
            {rows.length} orders
            {!sim && mail === null ? " · loading orders…" : ""}
          </span>
        </div>
        {!shown.length ? (
          <div className="empty">
            <Icon name="package" className="lg" />
            No orders here.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Type</th>
                  {!isClient && <th>Client</th>}
                  <th>Status</th>
                  <th>Warehouse</th>
                  <th>Carrier</th>
                  <th>Expected delivery</th>
                  <th title="When the order was accepted and released to the warehouse">Intake</th>
                  <th title="When the client placed the order">Ordered</th>
                  <th>Products</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={`${r.kind}-${r.id}`}
                    data-order
                    tabIndex={0}
                    onClick={() => open(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open(r);
                      }
                    }}
                  >
                    <td>
                      <span className="id">{r.id}</span>
                    </td>
                    <td>
                      <span className="chip ch">{TYPE[r.channel]}</span>
                    </td>
                    {!isClient && <td>{r.client ?? <span className="muted">No client linked</span>}</td>}
                    <td>
                      <span className={`chip ${r.kind === "sim" ? r.tone : CHIP[r.tone]}`}>{r.status}</span>
                    </td>
                    <td>{r.warehouse ?? <span className="muted">Pending</span>}</td>
                    <td>{r.carrier ?? <span className="muted">Pending</span>}</td>
                    <td>
                      {r.kind === "mail" ? (
                        <>
                          {deliveryDay(r.delivery.date)}
                          <span className="sub">{deliveryReason(r.delivery)}</span>
                        </>
                      ) : r.promise ? (
                        <span style={r.late ? { color: "var(--bad)" } : undefined}>{r.promise}</span>
                      ) : (
                        <span className="muted">Not set</span>
                      )}
                    </td>
                    <td className="mono">
                      {r.intake ? (
                        <>
                          {hhmm(r.intake)}
                          <span className="sub">{day(r.intake)}</span>
                        </>
                      ) : (
                        <span className="muted">Not yet</span>
                      )}
                    </td>
                    <td className="mono">
                      {hhmm(r.arrival)}
                      <span className="sub">{day(r.arrival)}</span>
                    </td>
                    <td>
                      <span style={CLIP} title={products(r) || undefined}>
                        {trimItems(products(r)) || <span className="muted">Not given yet</span>}
                      </span>
                    </td>
                    <td>
                      <span style={CLIP} title={address(r) || undefined}>
                        {address(r) || <span className="muted">Not given yet</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={current}
          pageSize={pageSize}
          total={rows.length}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          label="Orders pages"
          noun="orders"
        />
      </section>
    </>
  );
}

// A dropdown of checkboxes with an "All" option on top. Nothing ticked means all; ticking All clears the rest.
function MultiSelect<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [K, string, number][];
  value: K[];
  onChange: (v: K[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const picked = options.filter(([k]) => value.includes(k));
  const summary = !picked.length ? "All" : picked.length === 1 ? picked[0][1] : `${picked.length} selected`;
  const toggle = (k: K) => {
    const next = value.includes(k) ? value.filter((v) => v !== k) : [...value, k];
    // Every option ticked is the same as All.
    onChange(next.length === options.length ? [] : next);
  };

  return (
    <div className="umenu-wrap" ref={wrapRef}>
      <button
        className="btn btn-secondary"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="muted">{label}:</span> {summary}
        <Icon name="caret-down" />
      </button>
      {/* Above the table (its wrapper is positioned and comes later), below the sticky header. */}
      <div
        className="umenu"
        hidden={!open}
        style={{ left: 0, right: "auto", zIndex: 20, width: 224, transformOrigin: "top left" }}
      >
        <label className="umenu-i">
          <input type="checkbox" checked={!value.length} onChange={() => onChange([])} />
          All
        </label>
        {options.map(([k, l, n]) => (
          <label key={k} className="umenu-i">
            <input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} />
            {l}
            <span className="muted mono" style={{ marginLeft: "auto", fontSize: 12 }}>
              {n}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
