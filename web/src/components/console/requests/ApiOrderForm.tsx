"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import { ApiError } from "@/lib/api";
import { orderRequestsApi, type NewOrder } from "@/lib/emails";
import { ADDRESS_REQUIRED, totalAvailable, type Address } from "@/lib/order-request";
import { productsApi, type Product } from "@/lib/products";
import { deliveryDay, deliveryReason, settingsApi, type DeliveryRule } from "@/lib/settings";

const ADDRESS_FIELDS: [keyof Address, string, string][] = [
  ["street", "Street", "address-line1"],
  ["suite", "Suite or unit", "address-line2"],
  ["city", "City", "address-level2"],
  ["region", "State", "address-level1"],
  ["postal", "Postal code", "postal-code"],
  ["country", "Country", "country-name"],
];
const OPTIONAL: (keyof Address)[] = ["suite", "country"];
const EMPTY_ADDRESS: Address = { street: "", suite: "", city: "", region: "", postal: "", country: "" };
// The product tile colours the engine's order form used.
const WCOL = ["--s5", "--s2", "--s3", "--s4", "--s6", "--s0", "--s7", "--s1"];
const QUICK = [5, 10, 20, 40];

// Whether an order placed now makes the cutoff, read in the rule's zone (the API decides; this is the preview).
function beforeCutoff(rule: DeliveryRule) {
  const now = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: rule.timeZone }).format(new Date());
  return now < rule.sameDayCutoff;
}

// The client's New order page (/portal/orders/new), laid out like the engine's order form: products from their own
// catalogue, cartons of each and a shipping address, sent to POST /api/order-requests. The order arrives complete, so
// Halcyon routes it like a resolved emailed one; the same call works from the client's own system, shown in the summary.
export default function ApiOrderForm() {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<Product[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rule, setRule] = useState<DeliveryRule | null>(null);
  // productId → cartons, as typed; insertion order is the order lines are shown and sent in.
  const [qty, setQty] = useState<Record<string, string>>({});
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [reference, setReference] = useState("");
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    productsApi.list().then(
      (r) => {
        if (!active) return;
        setCatalogue(r.products);
        if (r.products[0]) setQty({ [r.products[0].productId]: "10" });
      },
      () => active && setFailed(true),
    );
    settingsApi.get().then(
      (r) => active && setRule(r.delivery),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed)
    return (
      <div className="card empty" role="alert">
        <Icon name="warning" className="lg" />
        We couldn’t load your catalogue from Halcyon.
        <Link className="btn btn-secondary btn-sm" href="/portal/orders">Back to orders</Link>
      </div>
    );
  if (!catalogue) return <div className="card empty" aria-busy="true">Loading your catalogue…</div>;

  const head = (
    <div className="page-h">
      <div>
        <p className="kick">Place an order</p>
        <h1>New order</h1>
        <p>
          Goes straight to Halcyon’s order team.{" "}
          {rule ? `Before ${rule.sameDayCutoff} it delivers today, after that the next day.` : "Same-day if it’s in before the cutoff, otherwise next day."}
        </p>
      </div>
    </div>
  );
  if (!catalogue.length)
    return (
      <div className="view">
        {head}
        <div className="card empty">
          <Icon name="cube" className="lg" />
          No products are stocked with Halcyon for your account yet, so there is nothing to order.
        </div>
      </div>
    );

  const chosen = catalogue.filter((p) => p.productId in qty);
  const cartons = (id: string) => Number.parseInt(qty[id] ?? "", 10);
  const badQty = chosen.filter((p) => !(cartons(p.productId) > 0));
  const missingAddress = ADDRESS_REQUIRED.filter((k) => !address[k].trim());
  const ready = chosen.length > 0 && !badQty.length && !missingAddress.length;
  const total = chosen.reduce((n, p) => n + (cartons(p.productId) || 0), 0);
  const short = chosen.filter((p) => cartons(p.productId) > totalAvailable(p));

  const toggle = (id: string) =>
    setQty((q) => {
      if (!(id in q)) return { ...q, [id]: "10" };
      const rest = { ...q };
      delete rest[id];
      return rest;
    });
  const setCartons = (id: string, v: string) => setQty((q) => ({ ...q, [id]: v }));
  const step = (id: string, by: number) => setCartons(id, String(Math.max(1, (cartons(id) || 0) + by)));

  const body = (): NewOrder => {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    return {
      reference: opt(reference),
      customer: opt(customer),
      lines: chosen.map((p) => ({ productId: p.productId, quantity: cartons(p.productId) })),
      address: {
        street: address.street.trim(),
        suite: opt(address.suite),
        city: address.city.trim(),
        region: address.region.trim(),
        postal: address.postal.trim(),
        country: opt(address.country),
      },
      notes: opt(notes),
    };
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTried(true);
    if (!ready) {
      const first = !chosen.length ? null : badQty[0] ? `qty-${badQty[0].productId}` : `new-${missingAddress[0]}`;
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    try {
      const placed = await orderRequestsApi.create(body());
      toast.success(`${placed.ref} placed. Expected ${deliveryDay(placed.expectedDelivery.date)} (${deliveryReason(placed.expectedDelivery).toLowerCase()}).`);
      if (placed.warning) toast(placed.warning, { icon: "⚠️", duration: 10_000 });
      router.push(`/portal/orders/${encodeURIComponent(placed.ref)}`);
    } catch (err) {
      // 400: the reasons the API gave. 409: the same order was placed moments ago; the message names it.
      toast.error(err instanceof ApiError && (err.status === 400 || err.status === 409) ? err.reasons() : "We couldn’t place the order. Try again.");
      setBusy(false);
    }
  };

  const sameDay = rule ? beforeCutoff(rule) : null;

  return (
    <div className="view">
      {head}
      <form className="no-grid" onSubmit={submit} noValidate>
        <div className="no-steps">
          <section className="card no-step">
            <div className="no-h">
              <span className="num">1</span>Choose products<span className="r">{catalogue.length} products</span>
            </div>
            <div className="pick" role="group" aria-label="Products">
              {catalogue.map((p, i) => (
                <label key={p.productId} className="opt" style={{ "--c": `var(${WCOL[i % WCOL.length]})` } as React.CSSProperties}>
                  <input type="checkbox" checked={p.productId in qty} onChange={() => toggle(p.productId)} />
                  <span className="pc-tile"><Icon name="cube" /></span>
                  <span className="t">
                    {p.productName}
                    <span>{p.sku} · {totalAvailable(p).toLocaleString("en-US")} in stock</span>
                  </span>
                  <span className="ck"><Icon name="check" /></span>
                </label>
              ))}
            </div>
            {tried && !chosen.length && <span className="ferr">Pick at least one product.</span>}
          </section>

          <section className="card no-step">
            <div className="no-h">
              <span className="num">2</span>Quantity
            </div>
            {!chosen.length && <span className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>Pick a product above to set how many cartons.</span>}
            {chosen.map((p) => {
              const bad = tried && !(cartons(p.productId) > 0);
              return (
                <div key={p.productId} style={{ display: "grid", gap: 8 }}>
                  {chosen.length > 1 && <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 500 }}>{p.productName}</span>}
                  <div className="qty">
                    <div className="stepper">
                      <button type="button" aria-label={`One fewer carton of ${p.productName}`} onClick={() => step(p.productId, -1)}>
                        <Icon name="minus" />
                      </button>
                      <label className="sr" htmlFor={`qty-${p.productId}`}>Cartons of {p.productName}</label>
                      <input
                        className="input"
                        id={`qty-${p.productId}`}
                        inputMode="numeric"
                        value={qty[p.productId]}
                        aria-invalid={bad || undefined}
                        onChange={(e) => setCartons(p.productId, e.target.value.replace(/\D/g, ""))}
                      />
                      <button type="button" aria-label={`One more carton of ${p.productName}`} onClick={() => step(p.productId, 1)}>
                        <Icon name="plus" />
                      </button>
                    </div>
                    <div className="qchips">
                      {QUICK.map((n) => (
                        <button key={n} type="button" onClick={() => setCartons(p.productId, String(n))}>{n}</button>
                      ))}
                    </div>
                    <span className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>cartons</span>
                  </div>
                  {bad && <span className="ferr">Enter at least 1 carton.</span>}
                </div>
              );
            })}
            <div className="grid2">
              <label className="field">
                Your PO number <span className="help">Optional</span>
                <input className="input" maxLength={64} value={reference} placeholder="e.g. 55120" onChange={(e) => setReference(e.target.value)} />
              </label>
              <label className="field">
                Deliver to (name) <span className="help">Optional</span>
                <input className="input" maxLength={120} value={customer} onChange={(e) => setCustomer(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="card no-step">
            <div className="no-h">
              <span className="num">3</span>Ship to<span className="r">Picks the nearest warehouse with stock</span>
            </div>
            <div className="grid2">
              {ADDRESS_FIELDS.map(([k, label, auto]) => {
                const bad = tried && missingAddress.includes(k);
                return (
                  <label key={k} className="field" htmlFor={`new-${k}`}>
                    <span>
                      {label} {OPTIONAL.includes(k) && <span className="help">Optional</span>}
                    </span>
                    <input
                      id={`new-${k}`}
                      className="input"
                      value={address[k]}
                      autoComplete={auto}
                      aria-invalid={bad || undefined}
                      onChange={(e) => setAddress((a) => ({ ...a, [k]: e.target.value }))}
                    />
                    {bad && <span className="ferr">Enter the {label.toLowerCase()}.</span>}
                  </label>
                );
              })}
            </div>
            <label className="field">
              Notes <span className="help">Optional · anything the warehouse should know</span>
              <textarea className="textarea" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </section>
        </div>

        <aside className="card no-sum" aria-label="Order summary">
          <div className="sum-b">
            <div className="sum-eta">
              <span>Expected delivery</span>
              <b>{sameDay === null ? "Same or next day" : sameDay ? "Today" : "Next day"}</b>
              <span>{rule ? `${sameDay ? "In before" : "After"} the ${rule.sameDayCutoff} cutoff · confirmed when placed` : "Confirmed when placed"}</span>
            </div>
            <dl className="sum-l">
              <dt>Products</dt>
              <dd>{chosen.length ? chosen.map((p) => p.productName).join(", ") : "–"}</dd>
              <dt>Cartons</dt>
              <dd className="mono">{total || "–"}</dd>
              <dt>Ship to</dt>
              <dd>{address.street.trim() && address.city.trim() ? `${address.street.trim()}, ${address.city.trim()}` : "–"}</dd>
              {reference.trim() && (
                <>
                  <dt>PO</dt>
                  <dd className="mono">{reference.trim()}</dd>
                </>
              )}
            </dl>
            {short.length > 0 && (
              <div className="callout warn">
                <Icon name="warehouse" />
                <span>More cartons than Halcyon holds of {short.map((p) => p.sku).join(", ")}. We’ll let you know if it needs a new date.</span>
              </div>
            )}
            <button className="btn btn-cta" type="submit" disabled={busy} aria-busy={busy}>
              <Icon name="paper-plane-tilt" />
              {busy ? "Placing…" : "Place order"}
            </button>
            <Link className="btn btn-quiet" href="/portal/orders">Cancel</Link>
            <details>
              <summary className="muted" style={{ fontSize: 12, lineHeight: "16px", cursor: "pointer" }}>Place it from your own system</summary>
              <pre className="rq-email">{`POST /api/order-requests\nContent-Type: application/json\n\n${JSON.stringify(
                ready ? body() : { reference: "PO-1042", lines: [{ sku: catalogue[0].sku, quantity: 10 }], address: { street: "200 W Madison St", city: "Chicago", region: "IL", postal: "60606" } },
                null,
                2,
              )}`}</pre>
            </details>
          </div>
        </aside>
      </form>
    </div>
  );
}
