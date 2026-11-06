"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Spinner from "@/components/Spinner";
import { cartTotal, marketplaceApi, money, saveCart, useCart, type MarketplacePage, type MarketplaceProduct } from "@/lib/marketplace";

const PAGE_SIZE = 24;
const MAX_CARTONS = 100000;

// The public shop: products from the API, a cart, and Place order, which moves on to creating the buyer's client.
export default function MarketplaceView() {
  const router = useRouter();
  const cart = useCart();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<MarketplacePage | null>(null);
  const [failed, setFailed] = useState(false);

  // Waits for a pause in typing, so each letter isn't a request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let current = true;
    marketplaceApi
      .products({ q: q || undefined, category: category || undefined, limit: PAGE_SIZE, offset })
      .then((next) => {
        if (!current) return;
        setPage(next);
        setFailed(false);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [q, category, offset]);

  const add = (p: MarketplaceProduct) => {
    const held = cart.find((l) => l.productId === p.productId);
    if (held) setQuantity(p.productId, held.quantity + 1);
    else saveCart([...cart, { productId: p.productId, sku: p.sku, productName: p.productName, unitPriceUsd: p.unitPriceUsd, quantity: 1 }]);
  };
  const setQuantity = (productId: string, quantity: number) =>
    saveCart(cart.flatMap((l) => (l.productId !== productId ? [l] : quantity > 0 ? [{ ...l, quantity: Math.min(quantity, MAX_CARTONS) }] : [])));

  return (
    <main className="mk wrap">
      <div className="mk-head">
        <span className="kicker">Marketplace</span>
        <h1>Order from Halcyon&apos;s catalogue.</h1>
        <p className="lede">Open to everyone. Browse, fill your cart, and create your client account when you place the order.</p>
      </div>

      <div className="mk-layout">
        <section aria-label="Products">
          <div className="mk-filters">
            <input
              className="mk-input"
              type="search"
              aria-label="Search products"
              placeholder="Search name or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="mk-input"
              aria-label="Category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All categories</option>
              {page?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {failed ? (
            <p className="mk-note" role="alert">We couldn&apos;t load the products. Refresh the page to try again.</p>
          ) : !page ? (
            <p className="mk-note"><Spinner /> Loading products…</p>
          ) : !page.products.length ? (
            <p className="mk-note">No products match that search.</p>
          ) : (
            <>
              <div className="mk-grid">
                {page.products.map((p) => (
                  <article key={p.productId} className="mk-card">
                    <span className="mk-cat">{p.category}</span>
                    <h2>{p.productName}</h2>
                    <span className="mk-sku">{p.sku}</span>
                    <div className="mk-buy">
                      <b>{money(p.unitPriceUsd)}<small> / carton</small></b>
                      <button className="btn btn-line btn-sm" type="button" disabled={!p.inStock} onClick={() => add(p)} aria-label={`Add ${p.productName} to cart`}>
                        {p.inStock ? "Add" : "Out of stock"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="mk-pager">
                <button className="btn btn-line btn-sm" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
                <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} of {page.total.toLocaleString("en-US")}</span>
                <button className="btn btn-line btn-sm" type="button" disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
              </div>
            </>
          )}
        </section>

        <aside className="mk-cart" aria-label="Cart">
          <h2>Your cart</h2>
          {!cart.length && <p className="mk-note">Nothing here yet. Add a product to start.</p>}
          {cart.map((l) => (
            <div key={l.productId} className="mk-line">
              <span>{l.productName}<small>{money(l.unitPriceUsd)} each</small></span>
              <input
                className="mk-input mk-qty"
                inputMode="numeric"
                aria-label={`Cartons of ${l.productName}`}
                value={l.quantity}
                onChange={(e) => setQuantity(l.productId, Number(e.target.value.replace(/\D/g, "")))}
              />
              <button className="mk-x" type="button" aria-label={`Remove ${l.productName}`} onClick={() => setQuantity(l.productId, 0)}><span aria-hidden="true">×</span></button>
            </div>
          ))}
          {cart.length > 0 && <div className="mk-total"><span>Total</span><b>{money(cartTotal(cart))}</b></div>}
          <button className="btn btn-blue" type="button" disabled={!cart.length} onClick={() => router.push("/marketplace/create-client")}>
            Place order <span className="arr" aria-hidden="true">→</span>
          </button>
        </aside>
      </div>
    </main>
  );
}
