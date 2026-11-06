"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import Table, { type Column } from "@/components/Table";
import { productsApi, type Product, type WarehouseStock } from "@/lib/products";
import { stockoutsApi, type Resolution, type Stockout } from "@/lib/stockouts";
import { warehousesApi, type Warehouse } from "@/lib/warehouses";
import { rebalanceApi, type StockTransfer } from "@/lib/rebalance";
import RebalanceDialog, { type RebalanceRequest } from "./RebalanceDialog";


const isLow = (s: WarehouseStock) => s.available <= s.reorderPoint;
const STOCKOUT_DAYS = 30;

const RESOLUTION: Record<Resolution, { label: string; tone: string }> = {
  rerouted: { label: "Shipped from farther", tone: "warn" },
  delayed: { label: "New date offered", tone: "bad" },
  shipped_short: { label: "Routed there anyway", tone: "bad" },
};
const totalOf = (p: Product) => p.stock.reduce((sum, s) => sum + s.available, 0);

// Stock of every client's products in each warehouse, from the database: available cartons (on hand less reserved),
// amber at or below the reorder point, a dash where the product isn't stocked. Stock-outs today come from the
// simulation running in the layout. Rebalance asks the allocation agent for transfers, which staff review in a popup
// and apply: they're saved, and order routing (Resolve's warehouse choice) works from the new stock.
export default function InventoryView() {
  // The simulation's rules are admin-only, so contributors don't see which allocation rule is on.
  const [products, setProducts] = useState<Product[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState(false);
  const [client, setClient] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [rebalancing, setRebalancing] = useState<RebalanceRequest | null>(null);
  // null while loading; the stock table doesn't wait for it, and a failure only hides the log.
  const [stockouts, setStockouts] = useState<Stockout[] | null>(null);
  const [stockoutError, setStockoutError] = useState(false);
  const [transfers, setTransfers] = useState<StockTransfer[] | null>(null);
  const [transferError, setTransferError] = useState(false);
  // Bumped after applying a rebalance, to reload stock and transfers from the API.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([productsApi.list(), warehousesApi.list()])
      .then(([p, w]) => {
        if (!active) return;
        setProducts(p.products);
        setWarehouses(w.warehouses);
      })
      .catch(() => active && setError(true));
    stockoutsApi
      .list(STOCKOUT_DAYS)
      .then((r) => active && setStockouts(r.stockouts))
      .catch(() => active && setStockoutError(true));
    rebalanceApi
      .transfers(STOCKOUT_DAYS)
      .then((r) => active && setTransfers(r.transfers))
      .catch(() => active && setTransferError(true));
    return () => {
      active = false;
    };
  }, [version]);

  const clients = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of products ?? []) names.set(p.clientId, p.clientName ?? p.clientId);
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [products]);

  const q = query.trim().toLowerCase();
  const rows = (products ?? []).filter(
    (p) =>
      (client === "all" || p.clientId === client) &&
      (!lowOnly || p.stock.some(isLow)) &&
      (!q || [p.productName, p.sku, p.productId, p.category, p.clientName ?? p.clientId].join(" ").toLowerCase().includes(q)),
  );
  const stockAt = (p: Product, warehouseId: string) => p.stock.find((s) => s.warehouseId === warehouseId);
  // Cartons missed at a warehouse as the nearest one, over the log's window.
  const missedAt = (warehouseId: string, productId?: string) =>
    (stockouts ?? [])
      .filter((e) => e.nearestWarehouseId === warehouseId && (!productId || e.productId === productId))
      .reduce((sum, e) => sum + e.quantity, 0);

  const productNames = useMemo(() => new Map((products ?? []).map((p) => [p.productId, p.productName])), [products]);
  const warehouseNames = useMemo(() => new Map(warehouses.map((w) => [w.warehouseId, w.warehouseName ?? w.warehouseId])), [warehouses]);

  // Saved by the dialog; reload so the table shows the stock routing now works from.
  const applied = (saved: StockTransfer[], delayDays: number) => {
    setRebalancing(null);
    setVersion((v) => v + 1);
    const units = saved.reduce((sum, t) => sum + t.quantity, 0);
    toast.success(
      `${saved.length} transfer${saved.length === 1 ? "" : "s"} applied (${units} cartons). ` +
        (delayDays ? `They arrive in ${delayDays} day${delayDays === 1 ? "" : "s"}.` : "Stock updated; new orders route on it now."),
    );
  };
  // Cartons on the way to a warehouse.
  const incomingAt = (warehouseId: string, productId: string) =>
    (transfers ?? [])
      .filter((t) => t.status === "in_transit" && t.destination === warehouseId && t.productId === productId)
      .reduce((sum, t) => sum + t.quantity, 0);

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Inventory</h1>
          <p>
            Cartons available per warehouse; amber is at or below the reorder point, a dash is not stocked there. A
            stock-out sends the order from a farther site and adds a day.
          </p>
        </div>
        <div className="acts">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!products?.length}
            onClick={() => setRebalancing({ label: "all products" })}
          >
            <Icon name="arrows-left-right" />
            Rebalance all
          </button>
        </div>
      </div>

      {error ? (
        <div className="card empty" role="alert">
          We couldn’t load inventory from Halcyon. Refresh the page to try again.
        </div>
      ) : (
        <>
          <section className="kpis" aria-label="Warehouses">
            {warehouses.map((w) => {
              const held = (products ?? []).map((p) => stockAt(p, w.warehouseId)).filter((s) => s !== undefined);
              const low = held.filter(isLow).length;
              const missed = (stockouts ?? []).filter((e) => e.nearestWarehouseId === w.warehouseId).length;
              return (
                <Kpi
                  key={w.warehouseId}
                  icon="warehouse"
                  color={low > 4 ? "--warn" : "--blue"}
                  label={w.warehouseName ?? w.warehouseId}
                  value={held.reduce((sum, s) => sum + s.available, 0).toLocaleString("en-US")}
                  note={`${low} SKUs low${missed ? ` · ${missed} stock-out${missed === 1 ? "" : "s"}` : ""}`}
                />
              );
            })}
          </section>

          <section className="card" aria-label="Stock by product">
            <div className="toolbar">
              <input
                className="input"
                type="search"
                aria-label="Search products"
                placeholder="Search name, SKU, category or client"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <select className="select" aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)}>
                <option value="all">All clients</option>
                {clients.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, lineHeight: "20px" }}>
                <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Only rows with a low warehouse
              </label>
            </div>
            {!products ? (
              <div className="empty" aria-busy="true">Loading inventory…</div>
            ) : (
              <Table
                label="Inventory"
                noun="products"
                rows={rows}
                rowKey={(p) => p.productId}
                empty={
                  <div className="empty">
                    <Icon name="check-circle" className="lg" />
                    {q ? `No products match “${query}”.` : "No low stock for this filter."}
                  </div>
                }
                columns={[
                  {
                    key: "product",
                    header: "Product",
                    cell: (p) => (
                      <>
                        {p.productName}
                        <span className="sub mono">{p.sku}</span>
                      </>
                    ),
                  },
                  { key: "client", header: "Client", cell: (p) => p.clientName ?? p.clientId },
                  ...warehouses.map(
                    (w): Column<Product> => ({
                      key: w.warehouseId,
                      header: w.warehouseName ?? w.warehouseId,
                      numeric: true,
                      cell: (p) => stockAt(p, w.warehouseId)?.available ?? "–",
                      cellClass: (p) => {
                        const s = stockAt(p, w.warehouseId);
                        return !s ? "muted" : s.available === 0 ? "cell-out" : isLow(s) ? "cell-lo" : undefined;
                      },
                      cellTitle: (p) => {
                        const s = stockAt(p, w.warehouseId);
                        const missed = missedAt(w.warehouseId, p.productId);
                        const base = s ? `Reorder at ${s.reorderPoint}` : "Not stocked here";
                        const incoming = incomingAt(w.warehouseId, p.productId);
                        return [
                          base,
                          missed ? `${missed} cartons missed here as the nearest warehouse (${STOCKOUT_DAYS} days)` : "",
                          incoming ? `${incoming} cartons in transit here` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                      },
                    }),
                  ),
                  { key: "total", header: "Total", numeric: true, cell: totalOf },
                  {
                    key: "rebalance",
                    header: <span className="sr">Rebalance</span>,
                    cell: (p) => (
                      <button className="btn btn-secondary btn-sm" type="button" disabled={!p.stock.length} onClick={() => setRebalancing({ productIds: [p.productId], label: p.sku })}>
                        <Icon name="arrows-left-right" />
                        Rebalance
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </section>

          <section className="card" aria-label="Stock-outs at the nearest warehouse">
            <div className="toolbar" style={{ display: "grid", gap: 4 }}>
              <strong>Stock-outs at the nearest warehouse</strong>
              <span className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>
                Orders in the last {STOCKOUT_DAYS} days that the warehouse nearest the customer couldn’t cover, logged as
                each order is routed. Rebalance counts them as demand at that warehouse.
              </span>
            </div>
            {stockoutError ? (
              <div className="empty" role="alert">We couldn’t load the stock-out log. Refresh the page to try again.</div>
            ) : !stockouts ? (
              <div className="empty" aria-busy="true">Loading stock-outs…</div>
            ) : (
              <Table
                label="Stock-outs at the nearest warehouse"
                noun="stock-outs"
                rows={stockouts}
                rowKey={(e) => e.id}
                empty={
                  <div className="empty">
                    <Icon name="check-circle" className="lg" />
                    Every order in the last {STOCKOUT_DAYS} days shipped from its nearest warehouse.
                  </div>
                }
                columns={[
                  {
                    key: "when",
                    header: "Routed",
                    cell: (e) => new Date(e.decidedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
                  },
                  {
                    key: "order",
                    header: "Order",
                    cell: (e) => (
                      <Link className="id" href={`/portal/emails/${encodeURIComponent(e.requestId)}`}>
                        {e.orderRef}
                      </Link>
                    ),
                  },
                  {
                    key: "product",
                    header: "Product",
                    cell: (e) => (
                      <>
                        {e.productName}
                        <span className="sub mono">{e.sku}</span>
                      </>
                    ),
                  },
                  {
                    key: "nearest",
                    header: "Nearest warehouse",
                    cell: (e) => (
                      <>
                        {warehouseNames.get(e.nearestWarehouseId) ?? e.nearestWarehouseId}
                        <span className="sub">to {e.region} · had {e.availableAtNearest} of {e.quantity}</span>
                      </>
                    ),
                  },
                  {
                    key: "outcome",
                    header: "Outcome",
                    cell: (e) => (
                      <>
                        <span className={`chip ${RESOLUTION[e.resolution].tone}`}>{RESOLUTION[e.resolution].label}</span>
                        {e.shippedFromId && e.resolution === "rerouted" && (
                          <span className="sub">from {warehouseNames.get(e.shippedFromId) ?? e.shippedFromId}</span>
                        )}
                      </>
                    ),
                  },
                  { key: "miles", header: "Extra miles", numeric: true, cell: (e) => (e.extraMiles === null ? "–" : `+${e.extraMiles.toLocaleString("en-US")}`) },
                  {
                    key: "rebalance",
                    header: <span className="sr">Rebalance</span>,
                    cell: (e) => (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={() => setRebalancing({ productIds: [e.productId], label: e.sku })}
                      >
                        <Icon name="arrows-left-right" />
                        Rebalance
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </section>

          <section className="card" aria-label="Stock transfers">
            <div className="toolbar" style={{ display: "grid", gap: 4 }}>
              <strong>Stock transfers</strong>
              <span className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>
                Rebalances applied in the last {STOCKOUT_DAYS} days, and any still in transit. The cartons leave the source
                when applied and count at the destination once they arrive.
              </span>
            </div>
            {transferError ? (
              <div className="empty" role="alert">We couldn’t load the stock transfers. Refresh the page to try again.</div>
            ) : !transfers ? (
              <div className="empty" aria-busy="true">Loading stock transfers…</div>
            ) : (
              <Table
                label="Stock transfers"
                noun="transfers"
                rows={transfers}
                rowKey={(t) => t.id}
                empty={
                  <div className="empty">
                    <Icon name="arrows-left-right" className="lg" />
                    No transfers applied in the last {STOCKOUT_DAYS} days.
                  </div>
                }
                columns={[
                  {
                    key: "when",
                    header: "Applied",
                    cell: (t) => new Date(t.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
                  },
                  {
                    key: "product",
                    header: "Product",
                    cell: (t) => (
                      <>
                        {t.productName}
                        <span className="sub mono">{t.sku}</span>
                      </>
                    ),
                  },
                  {
                    key: "route",
                    header: "From → to",
                    cell: (t) => `${warehouseNames.get(t.source) ?? t.source} → ${warehouseNames.get(t.destination) ?? t.destination}`,
                  },
                  { key: "qty", header: "Cartons", numeric: true, cell: (t) => t.quantity },
                  {
                    key: "status",
                    header: "Status",
                    cell: (t) =>
                      t.status === "completed" ? (
                        <span className="chip ok">Arrived</span>
                      ) : (
                        <>
                          <span className="chip warn">In transit</span>
                          <span className="sub">
                            arrives {new Date(t.arrivesAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        </>
                      ),
                  },
                  {
                    key: "origin",
                    header: "Source",
                    cell: (t) => (t.origin === "edited" ? <span className="chip">Edited by staff</span> : <span className="chip pri">Agent</span>),
                  },
                ]}
              />
            )}
          </section>
        </>
      )}

      <RebalanceDialog
        request={rebalancing}
        productNames={productNames}
        warehouseNames={warehouseNames}
        onClose={() => setRebalancing(null)}
        onApplied={applied}
      />
    </>
  );
}

function Kpi({ icon, color, label, value, note }: { icon: "warehouse" | "arrows-left-right"; color: string; label: string; value: string; note: string }) {
  return (
    <div className="card kpi" style={{ "--c": `var(${color})` } as React.CSSProperties}>
      <div className="kpi-label">
        <span className="kpi-ic"><Icon name={icon} /></span>
        {label}
      </div>
      <div className="kpi-val">{value}</div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}
