"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { useStock } from "@/lib/order-request";
import { useConsoleUser } from "./ConsoleShell";

// The client's catalogue with what's available to pick in each warehouse, from /api/products (which only returns their
// own products). Real data only.
export default function ClientProductsView() {
  const user = useConsoleUser();
  const { stock, failed } = useStock();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const products = stock?.products.filter((p) => !q || `${p.productName} ${p.sku} ${p.category}`.toLowerCase().includes(q)) ?? null;
  // Only the warehouses that hold any of their products get a column.
  const held = new Set(stock?.products.flatMap((p) => p.stock.map((s) => s.warehouseId)) ?? []);
  const warehouses = stock?.warehouses.filter((w) => held.has(w.warehouseId)) ?? [];

  return (
    <>
      <div className="page-h">
        <div>
          <p className="kick">{user.client?.clientName ?? "Your account"}</p>
          <h1>Products</h1>
          <p>Your catalogue and what’s available to ship from each warehouse right now.</p>
        </div>
        <div className="acts">
          <Link className="btn btn-cta" href="/portal/orders/new">
            <Icon name="plus" />
            New order
          </Link>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <label className="searchbox">
            <span className="sr">Search products</span>
            <Icon name="magnifying-glass" />
            <input className="input" placeholder="Product, SKU or category" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span className="muted" style={{ fontSize: 12, lineHeight: "16px" }}>
            {products ? `${products.length} products` : ""}
          </span>
        </div>
        {failed ? (
          <div className="empty" role="alert">
            We couldn’t load your products. Refresh the page to try again.
          </div>
        ) : !products ? (
          <div className="empty" aria-busy="true">Loading…</div>
        ) : !products.length ? (
          <div className="empty">
            <Icon name="cube" className="lg" />
            {q ? "No products match." : "No products are set up for your account yet."}
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Category</th>
                  {warehouses.map((w) => (
                    <th key={w.warehouseId} title={w.region ?? undefined}>
                      {w.warehouseName ?? w.warehouseId}
                    </th>
                  ))}
                  <th>Total available</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const total = p.stock.reduce((sum, s) => sum + s.available, 0);
                  return (
                    <tr key={p.productId}>
                      <td>{p.productName}</td>
                      <td className="mono">{p.sku}</td>
                      <td>{p.category}</td>
                      {warehouses.map((w) => {
                        const s = p.stock.find((x) => x.warehouseId === w.warehouseId);
                        return (
                          <td key={w.warehouseId} className="mono">
                            {s ? s.available.toLocaleString("en-US") : <span className="muted">—</span>}
                          </td>
                        );
                      })}
                      <td className="mono" style={total ? undefined : { color: "var(--bad)" }}>
                        {total ? total.toLocaleString("en-US") : "Out of stock"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
