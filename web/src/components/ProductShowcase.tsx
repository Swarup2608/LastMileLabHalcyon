"use client";

import { Fragment, useState, type CSSProperties } from "react";
import { allIn, laneData, laneNotes, orders, regions, risk } from "@/lib/halcyon-data";

const tabs = [
  { id: "t-queue", panel: "p-queue", label: "Review queue", count: 7 },
  { id: "t-lanes", panel: "p-lanes", label: "Carrier lanes" },
];

const queue = orders.filter((o) => o.A || o.C || o.S);

function ReviewQueue() {
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <>
      <div className="main-h">
        <h3>Review queue</h3>
        <span className="sub">Mon 5 Oct · W1–W5</span>
      </div>
      <div className="kpis" style={{ marginTop: 16 }}>
        <div className="kpi"><span>Orders today</span><b>287</b></div>
        <div className="kpi"><span>Held for address</span><b>33</b></div>
        <div className="kpi"><span>Promises changed</span><b>31</b></div>
        <div className="kpi"><span>Drafts to approve</span><b>12</b></div>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 16 }}>
        <table className="tbl">
          <thead>
            <tr><th>Order</th><th>Client</th><th>Channel</th><th>Received</th><th>Reason</th><th>Risk</th><th>Action</th></tr>
          </thead>
          <tbody>
            {queue.map((o) => {
              const r = risk(o);
              const cls = r >= 50 ? "h" : r >= 25 ? "m" : "l";
              const isDone = done.has(o.id);
              return (
                <tr key={o.id} style={isDone ? { opacity: 0.45 } : undefined}>
                  <td className="m">{o.id}</td>
                  <td>Client {o.c.slice(1)}</td>
                  <td>{o.ch}</td>
                  <td className="m">{o.ts}</td>
                  <td>
                    {o.A ? (
                      <span className="pill hold">Address: {o.A}</span>
                    ) : o.C ? (
                      <span className="pill warn">Same-day after 08:00</span>
                    ) : (
                      <span className="pill warn">{o.wh} out of stock</span>
                    )}
                  </td>
                  <td><span className={`rs ${cls}`}>{r}</span></td>
                  <td>
                    <button
                      className="act"
                      type="button"
                      disabled={isDone}
                      onClick={() => setDone((d) => new Set(d).add(o.id))}
                    >
                      {isDone ? "Done" : o.A ? "Request address" : o.C ? "Approve new date" : "Confirm warehouse"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CarrierLanes() {
  const [lane, setLane] = useState({ c: "F", r: "Southeast" });
  const ri = regions.indexOf(lane.r);
  const v = laneData[lane.c][ri];
  const ex = v > 10;
  const note =
    laneNotes[`${lane.c}-${lane.r}`] ||
    `Carrier ${lane.c} runs ${v.toFixed(1)}% late into the ${lane.r}, inside the 10% line. It competes on all-in cost: $${allIn[lane.c].toFixed(2)} per shipment including expected late costs.`;

  return (
    <>
      <div className="main-h">
        <h3>Carrier lanes</h3>
        <span className="sub">late rate on clean shipments · Apr–Sep</span>
      </div>
      <div className="lanes-split" style={{ marginTop: 16 }}>
        <div>
          <div className="heat">
            <div></div>
            {regions.map((r) => (
              <div className="hd" key={r}>{r}</div>
            ))}
            {Object.keys(laneData).map((c) => (
              <Fragment key={c}>
                <div className="rl">Carrier {c}</div>
                {laneData[c].map((val, i) => (
                  <button
                    key={regions[i]}
                    type="button"
                    className={"cell" + (val > 10 ? " bad" : "")}
                    style={{ "--v": Math.min(val, 46) } as CSSProperties}
                    aria-pressed={lane.c === c && lane.r === regions[i]}
                    aria-label={`Carrier ${c} to ${regions[i]}: ${val.toFixed(1)}% late`}
                    onClick={() => setLane({ c, r: regions[i] })}
                  >
                    {val.toFixed(1)}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
          <p className="foot" style={{ marginTop: 12 }}>
            Outlined: above the 10% exclusion line. Select a lane.
          </p>
        </div>
        <div className="lane-card" aria-live="polite">
          <div className="t">
            <span>{`Carrier ${lane.c} · ${lane.r}`}</span>
            <span className={"pill " + (ex ? "hold" : "ok")}>{ex ? "Excluded" : "Eligible"}</span>
          </div>
          <div className="big">
            {v.toFixed(1)}
            <small>% late</small>
          </div>
          <p>{note}</p>
          <div className="foot">RANKING · ALL-IN COST PER SHIPMENT</div>
          <div className="rank">
            {Object.keys(allIn)
              .sort((a, b) => allIn[a] - allIn[b])
              .map((k) => (
                <span key={k} className={laneData[k][ri] > 10 ? "x" : undefined}>
                  {`${k} · $${allIn[k].toFixed(2)}`}
                </span>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default function ProductShowcase() {
  const [active, setActive] = useState("p-queue");
  return (
    <div className="browser">
      <div className="b-bar">
        <div className="b-dots"><i></i><i></i><i></i></div>
        <div className="b-url">app.halcyon.example / halcyon / review-queue</div>
        <div style={{ width: 46 }}></div>
      </div>
      <div className="app">
        <div className="side" role="tablist" aria-label="Halcyon sections">
          <div className="ws"><i>H</i>Halcyon Logistics</div>
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={t.id}
              aria-selected={active === t.panel}
              aria-controls={t.panel}
              onClick={() => setActive(t.panel)}
            >
              {t.label}
              {t.count !== undefined && <> <span className="cnt">{t.count}</span></>}
            </button>
          ))}
          <div className="sep"></div>
          <div className="who">Signed in as coordinator</div>
        </div>
        <div className="main">
          <div className="panel" id="p-queue" role="tabpanel" aria-labelledby="t-queue" hidden={active !== "p-queue"}>
            <ReviewQueue />
          </div>
          <div className="panel" id="p-lanes" role="tabpanel" aria-labelledby="t-lanes" hidden={active !== "p-lanes"}>
            <CarrierLanes />
          </div>
        </div>
      </div>
    </div>
  );
}
