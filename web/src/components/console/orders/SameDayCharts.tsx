"use client";

import { useState } from "react";
import { BAD_BELOW, BY_CARRIER, BY_WAREHOUSE, BY_WINDOW, CARRIER_SAME_DAY_RATE, DRIVERS, GOOD_FROM, REGIONS, SAME_DAY_OVERALL, type Cell } from "@/lib/same-day-data";

const fmt = (n: number) => n.toLocaleString("en-US");
// Status, never a series colour: failing lanes red, healthy ones green, the rest neutral. The number is always printed,
// so the colour is never the only cue.
const tone = (pct: number) => (pct < BAD_BELOW ? "bad" : pct >= GOOD_FROM ? "good" : "mid");
const CELL_BG = { bad: "var(--bad-soft)", good: "var(--ok-soft)", mid: "var(--raised)" } as const;
const CELL_INK = { bad: "var(--bad)", good: "var(--ok)", mid: "var(--text)" } as const;

// Same-day delivery in the dataset: when the order arrives decides it, far more than the warehouse or region.
export default function SameDayCharts() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 24 }}>
      <section className="card" style={{ padding: "20px 24px" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Same-day on-time rate</p>
        <p style={{ margin: "4px 0 0", fontSize: 32, lineHeight: "40px", fontWeight: 700 }}>
          {SAME_DAY_OVERALL[0]}%
          <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 12 }}>
            of {fmt(SAME_DAY_OVERALL[1])} same-day deliveries, Apr–Sep 2026
          </span>
        </p>
      </section>

      <Heatmap
        title="Same-day is lost at the 08:00 pick list"
        sub="On-time rate by when the order arrived and where it goes. Red is below 50%, green 70% or more."
        rowHead="Received"
        rows={BY_WINDOW}
        note="Orders in before 08:00 make it about three times in four, in every region; after 08:00 it drops below 40%. 54% of same-day orders arrive after the cutoff."
      />

      <Heatmap
        title="A far warehouse costs less than a late order"
        sub="On-time rate by the warehouse it shipped from and where it goes. Small cells are few deliveries; hover for the count."
        rowHead="Ships from"
        rows={BY_WAREHOUSE}
        note="Each warehouse ships mostly to its own region at 53–58%. Off-region same-day (W3 to the Midwest, W1 to the Northeast) falls to around 40%, but on a few dozen orders each."
      />

      <Heatmap
        title="Same-day doesn’t pick a carrier"
        sub="On-time rate by carrier and where it goes, same-day deliveries only, with each carrier’s average same-day rate."
        rowHead="Carrier"
        rows={BY_CARRIER}
        extra={{ head: "Avg rate", values: CARRIER_SAME_DAY_RATE }}
        note="Every carrier lands between 54% and 59% on same-day, so the cheapest one costs nothing in reliability here: F, the preferred supplier, is both cheapest and best at 59%."
      />

      <Drivers />
    </div>
  );
}

// extra: a plain column after the cells (e.g. a price), keyed by row label.
function Heatmap({
  title,
  sub,
  rowHead,
  rows,
  note,
  extra,
}: {
  title: string;
  sub: string;
  rowHead: string;
  rows: [string, Cell[]][];
  note: string;
  extra?: { head: string; values: Record<string, string> };
}) {
  const [hover, setHover] = useState<string | null>(null);
  const cols = [...REGIONS, "All regions"];
  return (
    <section className="card" style={{ padding: "20px 24px" }} aria-label={title}>
      <h3 style={{ margin: 0, fontSize: 18, lineHeight: "26px" }}>{title}</h3>
      <p className="muted" style={{ margin: "4px 0 16px", fontSize: 14 }}>{sub}</p>
      <div className="tbl-wrap">
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 2, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th className="muted" style={{ textAlign: "left", fontWeight: 500, fontSize: 13, padding: "8px 12px" }}>{rowHead}</th>
              {cols.map((c) => (
                <th key={c} className="muted" style={{ fontWeight: 500, fontSize: 13, padding: "8px 12px" }}>{c}</th>
              ))}
              {extra && <th className="muted" style={{ fontWeight: 500, fontSize: 13, padding: "8px 12px" }}>{extra.head}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cells]) => (
              <tr key={label}>
                <th scope="row" style={{ textAlign: "left", fontWeight: 600, fontSize: 14, padding: "0 12px", whiteSpace: "nowrap" }}>{label}</th>
                {cells.map(([pct, n], i) => {
                  const t = tone(pct);
                  const key = `${label}|${cols[i]}`;
                  return (
                    <td
                      key={key}
                      tabIndex={0}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(key)}
                      onBlur={() => setHover(null)}
                      aria-label={`${label}, ${cols[i]}: ${pct}% on time of ${fmt(n)}`}
                      style={{
                        background: CELL_BG[t],
                        color: CELL_INK[t],
                        textAlign: "center",
                        padding: "14px 8px",
                        fontWeight: 600,
                        fontSize: 15,
                        borderRadius: 4,
                        outline: hover === key ? "2px solid var(--text)" : undefined,
                        outlineOffset: -2,
                        borderLeft: i === cols.length - 1 ? "2px solid var(--surface)" : undefined,
                      }}
                    >
                      {pct}%
                    </td>
                  );
                })}
                {extra && (
                  <td style={{ textAlign: "center", padding: "14px 8px", fontWeight: 600, fontSize: 15, background: "var(--raised)", borderRadius: 4 }}>
                    {extra.values[label] ?? "–"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: "12px 0 0", fontSize: 13, minHeight: 20 }} aria-live="polite">
        {hover ? (() => {
          const [row, col] = hover.split("|");
          const cell = rows.find(([l]) => l === row)![1][cols.indexOf(col)];
          return `${row} → ${col}: ${cell[0]}% on time, ${fmt(cell[1])} deliveries`;
        })() : note}
      </p>
    </section>
  );
}

// What each condition does to the on-time rate, against the overall rate as a reference line.
function Drivers() {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <section className="card" style={{ padding: "20px 24px" }} aria-label="What decides same-day">
      <h3 style={{ margin: 0, fontSize: 18, lineHeight: "26px" }}>Before 08:00, a full address and stock: 86% on time</h3>
      <p className="muted" style={{ margin: "4px 0 16px", fontSize: 14 }}>
        Same-day on-time rate under each condition. The line is the overall {SAME_DAY_OVERALL[0]}%.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {DRIVERS.map(([label, pct], i) => {
          const t = tone(pct);
          return (
            <div
              key={label}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) minmax(0, 1fr) 48px", alignItems: "center", gap: 12, fontSize: 14 }}
            >
              <span>{label}</span>
              <span style={{ position: "relative", height: 20, background: "var(--raised)", borderRadius: 4 }}>
                <span
                  style={{
                    position: "absolute",
                    inset: "0 auto 0 0",
                    width: `${pct}%`,
                    borderRadius: 4,
                    background: t === "bad" ? "var(--bad)" : t === "good" ? "var(--ok)" : "var(--muted)",
                    opacity: hover === null || hover === i ? 1 : 0.5,
                  }}
                />
                <span aria-hidden="true" style={{ position: "absolute", top: -3, bottom: -3, left: `${SAME_DAY_OVERALL[0]}%`, width: 2, background: "var(--text)" }} />
              </span>
              <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct}%</b>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ margin: "12px 0 0", fontSize: 13, minHeight: 20 }} aria-live="polite">
        {hover !== null
          ? `${DRIVERS[hover][0]}: ${DRIVERS[hover][1]}% on time across ${fmt(DRIVERS[hover][2])} same-day deliveries`
          : "Carriers barely matter for same-day: every carrier lands between 54% and 59%."}
      </p>
    </section>
  );
}
