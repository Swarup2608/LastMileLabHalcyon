"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";
import {
  rebalanceApi,
  type Decision,
  type ProductSuggestion,
  type RebalanceProductInput,
  type RebalanceSuggestion,
  type Risk,
  type StockTransfer,
} from "@/lib/rebalance";

// What to ask the agent about: one product, or every one (productIds left out).
export interface RebalanceRequest {
  productIds?: string[];
  label: string;
}

// A transfer as staff are editing it; quantity stays text while they type.
interface Draft {
  key: number;
  source: string;
  destination: string;
  quantity: string;
  reason: string;
  // false: added by staff, not suggested.
  suggested: boolean;
  // A suggested transfer staff changed.
  edited: boolean;
}

const DECISION: Record<Decision, { label: string; tone: string }> = {
  YES: { label: "Rebalance", tone: "pri" },
  NO: { label: "No change", tone: "ok" },
  REVIEW: { label: "Review", tone: "warn" },
};
const RISK: Record<Risk, string> = { HIGH: "bad", MEDIUM: "warn", LOW: "ok", UNKNOWN: "" };

let nextKey = 0;
const draftsOf = (s: ProductSuggestion): Draft[] =>
  s.recommendedTransfers.map((t) => ({
    key: nextKey++,
    source: t.source,
    destination: t.destination,
    quantity: String(t.quantity),
    reason: t.reason,
    suggested: true,
    edited: false,
  }));

const qtyOf = (d: Draft) => (/^\d+$/.test(d.quantity.trim()) ? Number(d.quantity) : NaN);

// Stock per warehouse after the drafts, and what's wrong with them.
function check(input: RebalanceProductInput, drafts: Draft[]) {
  const after = new Map(input.warehouses.map((w) => [w.id, w.availableStock]));
  const errors = new Map<number, string>();
  for (const d of drafts) {
    const q = qtyOf(d);
    if (d.source === d.destination) errors.set(d.key, "From and to are the same warehouse.");
    else if (!(q > 0)) errors.set(d.key, "Enter a whole number of cartons.");
    else {
      after.set(d.source, after.get(d.source)! - q);
      after.set(d.destination, after.get(d.destination)! + q);
    }
  }
  for (const d of drafts) {
    if (!errors.has(d.key) && after.get(d.source)! < 0) errors.set(d.key, `${d.source} doesn’t have that many available.`);
  }
  return { after, errors };
}

// Each request gets its own body, so opening the popup again starts from a fresh suggestion.
const ids = new WeakMap<RebalanceRequest, number>();
const idOf = (r: RebalanceRequest) => {
  if (!ids.has(r)) ids.set(r, nextKey++);
  return ids.get(r)!;
};

interface Props {
  request: RebalanceRequest | null;
  // By product id, for headings.
  productNames: Map<string, string>;
  warehouseNames: Map<string, string>;
  onClose: () => void;
  // The transfers just saved.
  onApplied: (transfers: StockTransfer[], delayDays: number) => void;
}

// The allocation agent's suggestion in a popup: per product its decision, risk and transfers, which staff can change,
// remove or add to, with the stock each warehouse would end up with. Apply saves them (POST /api/rebalance/apply).
export default function RebalanceDialog(props: Props) {
  const { request, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (request && !dlg.open) dlg.showModal();
    else if (!request && dlg.open) dlg.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      className="dlg"
      style={{ width: "min(1040px, calc(100vw - 32px))" }}
      aria-labelledby="rebalance-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {request && <Body key={idOf(request)} {...props} request={request} />}
    </dialog>
  );
}

function Body({ request, productNames, warehouseNames, onClose, onApplied }: Props & { request: RebalanceRequest }) {
  const [result, setResult] = useState<RebalanceSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    rebalanceApi
      .suggest(request.productIds)
      .then((r) => {
        if (!active) return;
        setResult(r);
        setDrafts(Object.fromEntries(r.plan.products.map((p) => [p.product, draftsOf(p)])));
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof ApiError && err.status === 503
            ? "The allocation agent isn’t set up. Set FOUNDRY_ALLOCATION_IQ_AGENT_NAME on the API to get rebalance suggestions."
            : err instanceof ApiError
              ? `Halcyon couldn’t get a suggestion: ${err.message}`
              : "We couldn’t reach Halcyon. Check your connection and try again.",
        );
      });
    return () => {
      active = false;
    };
  }, [request]);

  const inputs = useMemo(() => new Map(result?.input.products.map((p) => [p.product, p]) ?? []), [result]);
  const checks = useMemo(
    () => new Map([...inputs].map(([sku, input]) => [sku, check(input, drafts[sku] ?? [])])),
    [inputs, drafts],
  );
  const invalid = [...checks.values()].some((c) => c.errors.size > 0);
  const moves = Object.values(drafts).flat();
  const units = moves.reduce((s, d) => s + (qtyOf(d) || 0), 0);
  const edited = result?.plan.products.some((p) => {
    const ds = drafts[p.product] ?? [];
    const was = p.recommendedTransfers;
    return ds.length !== was.length || ds.some((d, i) => !d.suggested || d.source !== was[i].source || d.destination !== was[i].destination || qtyOf(d) !== was[i].quantity);
  });

  const many = (result?.plan.products.length ?? 0) > 1;
  const shown = (result?.plan.products ?? []).filter((p) => !many || showAll || p.decision !== "NO" || (drafts[p.product]?.length ?? 0) > 0);

  const update = (sku: string, key: number, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [sku]: all[sku].map((d) => (d.key === key ? { ...d, ...patch, edited: d.suggested } : d)) }));
  const remove = (sku: string, key: number) => setDrafts((all) => ({ ...all, [sku]: all[sku].filter((d) => d.key !== key) }));
  const add = (sku: string) => {
    const input = inputs.get(sku)!;
    const ws = [...input.warehouses].sort((a, b) => b.availableStock - a.availableStock);
    const draft: Draft = {
      key: nextKey++,
      source: ws[0]?.id ?? "",
      destination: ws[ws.length - 1]?.id ?? "",
      quantity: "",
      reason: "",
      suggested: false,
      edited: false,
    };
    setDrafts((all) => ({ ...all, [sku]: [...(all[sku] ?? []), draft] }));
  };
  const reset = () => result && setDrafts(Object.fromEntries(result.plan.products.map((p) => [p.product, draftsOf(p)])));

  const apply = async () => {
    const transfers = Object.entries(drafts).flatMap(([sku, ds]) =>
      ds.map((d) => ({
        productId: inputs.get(sku)!.productId,
        source: d.source,
        destination: d.destination,
        quantity: qtyOf(d),
        origin: d.suggested && !d.edited ? ("suggested" as const) : ("edited" as const),
        ...(d.suggested && d.reason ? { reason: d.reason.slice(0, 500) } : {}),
      })),
    );
    setApplying(true);
    setApplyError(null);
    try {
      const saved = await rebalanceApi.apply(transfers);
      onApplied(saved.transfers, saved.delayDays);
    } catch (err) {
      setApplyError(
        err instanceof ApiError
          ? err.status === 409
            ? `${err.message}. Stock changed since the suggestion; close and rebalance again.`
            : `Halcyon couldn’t apply the transfers: ${err.message}`
          : "We couldn’t reach Halcyon. Check your connection and try again.",
      );
    } finally {
      setApplying(false);
    }
  };
  const delay = result?.transferDelayDays ?? 0;
  const arrival = delay ? `arrive in ${delay} day${delay === 1 ? "" : "s"}` : "arrive immediately";

  const wName = (id: string) => warehouseNames.get(id) ?? id;
  const s = result?.plan.summary;

  return (
    <div className="dlg-b">
      <div>
        <h2 id="rebalance-title">Rebalance {request.label}</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>
          Suggested by the allocation agent from each warehouse’s stock, reorder point, the last 30 days of orders and the
          stock-outs logged at each order’s nearest warehouse.
          Change, remove or add transfers before applying. Applying saves them: the cartons leave each source now and{" "}
          {delay ? `reach the destination in ${delay} day${delay === 1 ? "" : "s"}` : "reach the destination immediately"},
          where order routing picks them up.
        </p>
      </div>

      {error ? (
        <p className="callout bad" role="alert">
          <Icon name="warning" />
          {error}
        </p>
      ) : !result ? (
        <div className="empty" aria-busy="true" style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <Spinner />
          Asking the allocation agent{request.productIds ? "" : " about every product"}… this can take a minute.
        </div>
      ) : (
        <>
          {many && s && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="chip pri">{s.reallocationRequired} to rebalance</span>
              <span className="chip warn">{s.reviewRequired} to review</span>
              <span className="chip ok">{s.noReallocationRequired} no change</span>
              {s.overallOutOfStockPercentage !== null && <span className="chip">{s.overallOutOfStockPercentage}% out of stock overall</span>}
              {s.estimatedOrdersAffected !== null && <span className="chip">{s.estimatedOrdersAffected} orders affected</span>}
              <label style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show products with no change
              </label>
            </div>
          )}

          {(result.plan.contributorNotes.length > 0 || result.warnings.length > 0) && (
            <details className="callout warn" style={{ display: "block" }}>
              <summary style={{ cursor: "pointer" }}>
                {result.warnings.length > 0 ? `${result.warnings.length} check${result.warnings.length === 1 ? "" : "s"} on the agent’s reply` : "Notes from the agent"}
              </summary>
              <ul style={{ margin: "8px 0 0 20px", display: "grid", gap: 4 }}>
                {result.plan.contributorNotes.map((n) => <li key={`n-${n}`}>{n}</li>)}
                {result.warnings.map((w) => <li key={`w-${w}`}>{w}</li>)}
              </ul>
            </details>
          )}

          <div style={{ display: "grid", gap: 16, maxHeight: "min(60dvh, 640px)", overflowY: "auto", paddingRight: 4 }}>
            {shown.length === 0 && (
              <div className="empty">
                <Icon name="check-circle" className="lg" />
                No product needs rebalancing.
              </div>
            )}
            {shown.map((p) => {
              const input = inputs.get(p.product)!;
              const ds = drafts[p.product] ?? [];
              const { after, errors } = checks.get(p.product)!;
              return (
                <section key={p.product} className="card" style={{ padding: 16, display: "grid", gap: 12 }} aria-label={p.product}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{productNames.get(input.productId) ?? input.productName}</strong>
                    <span className="mono muted" style={{ fontSize: 12 }}>{p.product}</span>
                    <span className={`chip ${DECISION[p.decision].tone}`} style={{ marginLeft: "auto" }}>{DECISION[p.decision].label}</span>
                    <span className={`chip ${RISK[p.stockoutRisk]}`}>{p.stockoutRisk.toLowerCase()} stock-out risk</span>
                  </div>
                  {p.reallocationReason && <p style={{ fontSize: 14, lineHeight: "20px" }}>{p.reallocationReason}</p>}
                  {p.expectedImpact && <p className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>{p.expectedImpact}</p>}

                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>From</th>
                          <th>To</th>
                          <th className="num">Cartons</th>
                          <th className="num">Miles</th>
                          <th>Why</th>
                          <th><span className="sr">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ds.length === 0 && (
                          <tr>
                            <td colSpan={6} className="muted">No transfers.</td>
                          </tr>
                        )}
                        {ds.map((d) => {
                          const route = input.routes.find((r) => r.from === d.source && r.to === d.destination);
                          const err = errors.get(d.key);
                          return (
                            <tr key={d.key}>
                              <td>
                                <select className="select" aria-label="From warehouse" value={d.source} onChange={(e) => update(p.product, d.key, { source: e.target.value })} style={{ minWidth: 140 }}>
                                  {input.warehouses.map((w) => <option key={w.id} value={w.id}>{wName(w.id)} ({w.availableStock})</option>)}
                                </select>
                              </td>
                              <td>
                                <select className="select" aria-label="To warehouse" value={d.destination} onChange={(e) => update(p.product, d.key, { destination: e.target.value })} style={{ minWidth: 140 }}>
                                  {input.warehouses.map((w) => <option key={w.id} value={w.id}>{wName(w.id)} ({w.availableStock})</option>)}
                                </select>
                              </td>
                              <td className="num">
                                <input
                                  className="input mono"
                                  inputMode="numeric"
                                  aria-label="Cartons"
                                  aria-invalid={!!err || undefined}
                                  value={d.quantity}
                                  onChange={(e) => update(p.product, d.key, { quantity: e.target.value })}
                                  style={{ width: 96, textAlign: "right" }}
                                />
                                {err && <span className="ferr" style={{ display: "block", whiteSpace: "normal" }}>{err}</span>}
                              </td>
                              <td className="num">{route?.distance ?? "–"}</td>
                              <td className="wrap">{d.suggested ? d.reason || <span className="muted">–</span> : <span className="muted">Added by you</span>}</td>
                              <td>
                                <button className="btn btn-secondary btn-sm" type="button" aria-label="Remove transfer" onClick={() => remove(p.product, d.key)}>
                                  <Icon name="minus" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => add(p.product)} disabled={input.warehouses.length < 2}>
                      <Icon name="plus" />
                      Add transfer
                    </button>
                    <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>After:</span>
                    {input.warehouses.map((w) => {
                      const n = after.get(w.id)!;
                      const tone = n < 0 || n === 0 ? "bad" : w.safetyBuffer !== null && n <= w.safetyBuffer ? "warn" : "";
                      return (
                        <span key={w.id} className={`chip ${tone}`} title={w.safetyBuffer !== null ? `Reorder at ${w.safetyBuffer}` : "Not stocked here"}>
                          {wName(w.id)} <span className="mono">{w.availableStock === n ? n : `${w.availableStock} → ${n}`}</span>
                        </span>
                      );
                    })}
                  </div>

                  <details>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>What the agent was sent</summary>
                  <div className="tbl-wrap" style={{ marginTop: 8 }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Warehouse</th>
                          <th className="num">Available</th>
                          <th className="num">Reorder at</th>
                          <th className="num">Orders</th>
                          <th className="num">Missed as nearest</th>
                          <th className="num">Out of stock</th>
                          <th className="num">Incoming</th>
                          <th className="num">Miles to customer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {input.warehouses.map((w) => (
                          <tr key={w.id}>
                            <td>{wName(w.id)}</td>
                            <td className="num">{w.availableStock}</td>
                            <td className="num">{w.safetyBuffer ?? "–"}</td>
                            <td className="num">{w.orders ?? "–"}</td>
                            <td className="num">{w.stockoutsAtNearest ?? 0}</td>
                            <td className="num">{w.outOfStockPercentage === null ? "–" : `${w.outOfStockPercentage}%`}</td>
                            <td className="num">{w.incomingStock?.quantity ?? "–"}</td>
                            <td className="num">{w.distanceToCustomer ?? "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>

                {(p.remainingShortage ?? 0) > 0 && (
                    <p className="callout warn"><Icon name="warning" />{p.remainingShortage} cartons still short after these transfers.</p>
                  )}
                  {p.notes.length > 0 && (
                    <ul className="muted" style={{ fontSize: 12, lineHeight: "16px", marginLeft: 16, display: "grid", gap: 2 }}>
                      {p.notes.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {applyError && (
        <p className="callout bad" role="alert">
          <Icon name="warning" />
          {applyError}
        </p>
      )}

      <div className="dlg-acts" style={{ alignItems: "center" }}>
        {result && (
          <span className="muted" style={{ fontSize: 14, marginRight: "auto" }}>
            {moves.length} transfer{moves.length === 1 ? "" : "s"} · {units} cartons{edited ? " · edited" : ""} · {arrival}
          </span>
        )}
        {result && edited && (
          <button className="btn btn-secondary" type="button" onClick={reset} disabled={applying}>
            Reset to suggestion
          </button>
        )}
        <button className="btn btn-secondary" type="button" onClick={onClose} disabled={applying}>
          Close
        </button>
        {result && (
          <button
            className="btn btn-brand"
            type="button"
            onClick={apply}
            disabled={invalid || moves.length === 0 || applying}
            aria-busy={applying}
          >
            {applying ? <Spinner /> : <Icon name="arrows-left-right" />}
            {applying ? "Applying…" : `Apply ${moves.length} transfer${moves.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
