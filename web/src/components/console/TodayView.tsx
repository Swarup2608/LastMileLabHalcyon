"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { carrierPlanApi, type CarrierPlanState } from "@/lib/carrier-plan";
import { deliveryDay } from "@/lib/settings";
import { emailExceptions, type EmailExceptionKind } from "./requests/emailExceptions";
import { useEmailedRows, useStaffRequests } from "./requests/useEmailedRows";

const ISSUE: Record<EmailExceptionKind, string> = {
  address: "Address missing",
  product: "Product unclear",
  qty: "Quantity missing",
  stock: "No warehouse has it all",
  answered: "Customer answered",
  stale: "No reply in a day",
};
const CHIP = { ok: "ok", warn: "warn", info: "blue", neutral: "" } as const;

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// The staff home page: what needs attention right now, from real orders only (the inbox and /api/carrier-plan). The
// simulation's command center is on the Simulation page.
export default function TodayView() {
  const rows = useEmailedRows("staff");
  const { requests, stock, edits } = useStaffRequests(true);
  const [plan, setPlan] = useState<CarrierPlanState | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  // Lets "No reply in a day" and "today" move on without waiting for a new poll.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    carrierPlanApi.get().then(
      (p) => active && setPlan(p),
      () => active && setPlanFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const issues = requests && stock ? emailExceptions(requests, (id) => edits[id] ?? {}, stock.products, stock.warehouses, now) : null;
  const today = rows?.filter((r) => sameDay(r.arrival, now)) ?? null;
  const routedToday = today?.filter((r) => r.routed).length ?? 0;
  const ready = requests?.filter((r) => r.status === "ready").length ?? null;
  const latest = rows ? [...rows].sort((a, b) => b.arrival - a.arrival).slice(0, 8) : null;

  const planValue = planFailed ? "Unavailable" : !plan ? "…" : !plan.enabled ? "Off" : plan.plan ? "Ready" : plan.cutoffPassed ? "Pending" : "Waiting";
  const planNote = planFailed
    ? "couldn’t load the carrier plan"
    : !plan
      ? "loading"
      : !plan.enabled
        ? "the carrier agent isn’t set up"
        : plan.plan
          ? `made for ${deliveryDay(plan.today)}`
          : plan.cutoffPassed
            ? "cutoff passed; run it on Carriers"
            : `after the ${plan.cutoff} cutoff`;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Today</h1>
          <p>What needs attention now, from real orders. The simulation is separate, on the Simulation page.</p>
        </div>
        <div className="acts">
          <Link className="btn btn-secondary" href="/portal/orders">
            <Icon name="package" />
            All orders
          </Link>
        </div>
      </div>

      <section className="kpis" aria-label="Today at a glance" style={{ marginBottom: 16 }}>
        <Kpi icon="package" color="--primary" label="Orders today" value={today ? String(today.length) : "…"} note={today ? `${routedToday} routed` : "loading"} />
        <Kpi
          icon="warning"
          color="--warn"
          label="Need a person"
          value={issues ? String(issues.length) : "…"}
          note={issues ? (issues.length ? "see Exceptions" : "nothing waiting") : "loading"}
          href="/portal/exceptions"
        />
        <Kpi icon="check-circle" color="--ok" label="Ready to route" value={ready === null ? "…" : String(ready)} note="complete, waiting for a warehouse" href="/portal/emails" />
        <Kpi icon="truck" color="--blue" label="Carrier plan" value={planValue} note={planNote} href="/portal/carriers" />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <Icon name="warning" />
          Needs a person
          <span className="r">
            <Link href="/portal/exceptions">Exceptions</Link>
          </span>
        </div>
        {!issues ? (
          <div className="empty" aria-busy="true">Loading…</div>
        ) : !issues.length ? (
          <div className="empty">
            <Icon name="check-circle" className="lg" />
            Nothing needs a person right now.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Issue</th>
                  <th>Customer</th>
                  <th>Detail</th>
                  <th>Waiting since</th>
                </tr>
              </thead>
              <tbody>
                {issues.slice(0, 6).map(({ kind, request: r, since, detail }) => (
                  <tr key={r.email.id}>
                    <td>
                      <Link className="id" href={`/portal/emails/${encodeURIComponent(r.email.id)}`}>
                        {r.ref}
                      </Link>
                    </td>
                    <td>
                      <span className="chip warn">{ISSUE[kind]}</span>
                    </td>
                    <td>{r.customer ?? r.sender.name}</td>
                    <td className="muted">{detail}</td>
                    <td className="mono">{hhmm(new Date(since).getTime())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            No orders yet.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Expected delivery</th>
                  <th>Received</th>
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
                    <td>{r.client ?? <span className="muted">No client linked</span>}</td>
                    <td>
                      <span className={`chip ${CHIP[r.tone]}`}>{r.status}</span>
                    </td>
                    <td>{deliveryDay(r.delivery.date)}</td>
                    <td className="mono">{hhmm(r.arrival)}</td>
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

function Kpi({ icon, color, label, value, note, href }: { icon: IconName; color: string; label: string; value: string; note: string; href?: string }) {
  const body = (
    <>
      <div className="kpi-label">
        <span className="kpi-ic">
          <Icon name={icon} />
        </span>
        {label}
      </div>
      <div className="kpi-val">{value}</div>
      <div className="kpi-note">{note}</div>
    </>
  );
  const style = { "--c": `var(${color})` } as React.CSSProperties;
  return href ? (
    <Link className="card kpi" href={href} style={{ ...style, textDecoration: "none", color: "inherit" }}>
      {body}
    </Link>
  ) : (
    <div className="card kpi" style={style}>
      {body}
    </div>
  );
}
