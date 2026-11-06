"use client";

import type { Fulfilment, WarehouseOption } from "@/lib/fulfilment";
import RqIcon from "./RqIcon";

const RANKED_BY = {
  agent: "the agent’s ranking",
  distance: "nearest first",
  stock: "most stock first",
} as const;

const nameOf = (o: WarehouseOption) => o.warehouse.warehouseName ?? o.warehouse.warehouseId;

// "Compact lamp (3 of 10), …": the matched lines this warehouse can't cover.
function shortOn(plan: Fulfilment, o: WarehouseOption) {
  return plan.lines
    .filter((l) => l.product)
    .map((l, i) => (o.available[i] < l.quantity ? `${l.product!.productName} (${o.available[i]} of ${l.quantity})` : null))
    .filter(Boolean)
    .join(", ");
}

// What's wrong with each ticked warehouse that isn't the suggested one: short on stock, farther than the suggestion, or
// just not the one the ranking picked. Empty when only the suggestion (or nothing) is ticked.
export function pickWarnings(plan: Fulfilment, picked: Set<string>): string[] {
  const { suggested, region } = plan;
  const matched = plan.lines.some((l) => l.product);
  const out: string[] = [];
  for (const o of plan.options) {
    if (!picked.has(o.warehouse.warehouseId) || o === suggested) continue;
    if (matched && !o.canShip) {
      out.push(`${nameOf(o)} is short on ${shortOn(plan, o)}. The order can’t ship in full from there until it’s restocked.`);
    } else if (suggested && o.miles !== null && suggested.miles !== null && o.miles > suggested.miles) {
      out.push(
        `${nameOf(o)} is ${(o.miles - suggested.miles).toLocaleString("en-US")} mi farther from ${region} than ${nameOf(suggested)}, the suggested warehouse, so delivery may be slower and cost more.`,
      );
    } else if (suggested) {
      out.push(`${nameOf(o)} isn’t the suggested warehouse; the ranking picked ${nameOf(suggested)}.`);
    }
  }
  if (suggested && picked.size > 1 && picked.has(suggested.warehouse.warehouseId))
    out.push(`${nameOf(suggested)} has everything in stock, so splitting the order across ${picked.size} warehouses isn’t needed.`);
  return out;
}

// Where to ship from, in the agent's ranking (or nearest first). The first warehouse that can ship it all is the top
// pick; the rest of the ranking folds away under it, and opens by itself when the first choice is short. Staff can tick
// any warehouse, short ones too; a pick other than the suggestion shows what's wrong with it.
export default function ShipFrom({
  plan,
  picked,
  onToggle,
  disabled,
}: {
  plan: Fulfilment;
  picked: Set<string>;
  onToggle: (warehouseId: string) => void;
  // Once routed, the choice is shown but can't change.
  disabled?: boolean;
}) {
  const { region, lines, options, ranking, suggested } = plan;
  const matched = lines.filter((l) => l.product);
  const first = options[0];
  const rest = options.filter((o) => o !== suggested);
  const rankOf = (o: WarehouseOption) => options.indexOf(o) + 1;
  const warnings = pickWarnings(plan, picked);

  const meta = (o: WarehouseOption) =>
    [
      o.warehouse.region,
      o.miles !== null ? `${o.miles.toLocaleString("en-US")} mi` : null,
      o.warehouse.pickListCutoff ? `pick by ${o.warehouse.pickListCutoff}` : null,
      o.warehouse.carrierCollectionWindow ? `collection ${o.warehouse.carrierCollectionWindow}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const check = (o: WarehouseOption) => (
    <input
      type="checkbox"
      aria-label={`Ship from ${nameOf(o)}`}
      checked={picked.has(o.warehouse.warehouseId)}
      disabled={disabled}
      onChange={() => onToggle(o.warehouse.warehouseId)}
    />
  );

  return (
    <div className="ship">
      <p className="rq-faint">
        Ranked by {RANKED_BY[ranking]}
        {region ? `, delivering to ${region}` : ""}
      </p>

      {suggested && suggested !== first ? (
        <p className="rq-note warn">
          <RqIcon name="alert" />
          <span>First choice, {nameOf(first)}, is short on {shortOn(plan, first)}. Next in line with everything in stock:</span>
        </p>
      ) : !suggested ? (
        <p className="rq-note bad">
          <RqIcon name="alert" />
          <span>No warehouse has all of it in stock.</span>
        </p>
      ) : null}

      {suggested && (
        <label className="ship-top">
          <span className="rk top">{rankOf(suggested)}</span>
          <span className="ship-main">
            <span className="ship-name">
              {nameOf(suggested)}
              <span className="rq-pill ok"><span className="dot" />Suggested</span>
            </span>
            <span className="ship-meta">{meta(suggested)}</span>
            {matched.length > 0 && (
              <span className="ship-lines">
                {matched.map((l, i) => (
                  <span key={l.product!.productId}>
                    <RqIcon name="checkCircle" />
                    {l.product!.productName}
                    <span className="mono">
                      {suggested.available[i].toLocaleString("en-US")} available · need {l.quantity}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </span>
          {check(suggested)}
        </label>
      )}

      {rest.length > 0 && (
        <details className="ship-more" open={!suggested || suggested !== first || rest.some((o) => picked.has(o.warehouse.warehouseId))}>
          <summary>
            <RqIcon name="chevR" className="caret" />
            {suggested ? `${rest.length} other warehouse${rest.length === 1 ? "" : "s"} in the ranking` : "The ranking"}
          </summary>
          <ol className="ship-rest">
            {rest.map((o) => (
              <li key={o.warehouse.warehouseId} data-short={o.canShip ? undefined : ""}>
                <label>
                  <span className="rk">{rankOf(o)}</span>
                  <span className="ship-who">
                    {nameOf(o)}
                    <span>{o.canShip || !matched.length ? meta(o) : `Short on ${shortOn(plan, o)}`}</span>
                  </span>
                  {matched.length > 0 &&
                    (o.canShip ? <span className="rq-pill ok">Has stock</span> : <span className="rq-pill bad">Short</span>)}
                  {check(o)}
                </label>
              </li>
            ))}
          </ol>
        </details>
      )}

      {warnings.length > 0 && (
        <div className="rq-note bad" role="alert" style={{ marginTop: 12 }}>
          <RqIcon name="alert" />
          <span>
            <b>{suggested ? "Not the suggested warehouse" : "Short on stock"}</b>
            {warnings.map((w) => (
              <span key={w} className="rq-sub">{w}</span>
            ))}
            <span className="rq-sub">You can still route it; the choice is recorded as an override.</span>
          </span>
        </div>
      )}
    </div>
  );
}
