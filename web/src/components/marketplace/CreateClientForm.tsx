"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import toast from "react-hot-toast";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";
import { cartTotal, marketplaceApi, money, saveCart, useCart } from "@/lib/marketplace";
import { PASSWORD_HINT, passwordProblem } from "@/lib/password";

const FIELDS: [key: string, label: string, apiPath: string, type?: string, autoComplete?: string][] = [
  ["companyName", "Company name", "companyName", "text", "organization"],
  ["name", "Your name", "contact.name", "text", "name"],
  ["email", "Work email", "contact.email", "email", "email"],
  ["password", "Choose a password", "contact.password", "password", "new-password"],
  ["street", "Street", "order.address.street", "text", "address-line1"],
  ["suite", "Suite or unit", "order.address.suite", "text", "address-line2"],
  ["city", "City", "order.address.city", "text", "address-level2"],
  ["region", "State", "order.address.region", "text", "address-level1"],
  ["postal", "Postal code", "order.address.postal", "text", "postal-code"],
  ["reference", "Your PO number", "order.reference"],
];
const OPTIONAL = ["suite", "reference"];

// Where Place order leads: creates the buyer's client and login, places the cart as its first order, and opens it.
export default function CreateClientForm() {
  const router = useRouter();
  const cart = useCart();
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const missing = Object.fromEntries(
      FIELDS.filter(([key]) => !OPTIONAL.includes(key) && !form[key]?.trim()).map(([key, label]) => [key, `Enter the ${label.toLowerCase()}.`]),
    );
    const weak = form.password ? passwordProblem(form.password) : null;
    if (weak) missing.password = weak;
    setErrors(missing);
    setTaken(false);
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      const placed = await marketplaceApi.placeOrder({
        companyName: form.companyName,
        contact: { name: form.name, email: form.email, password: form.password },
        order: {
          reference: form.reference || undefined,
          lines: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          address: { street: form.street, suite: form.suite || undefined, city: form.city, region: form.region, postal: form.postal },
        },
      });
      saveCart([]);
      toast.success(`${placed.ref} placed. Welcome to Halcyon.`);
      if (placed.warning) toast(placed.warning);
      // The portal is a separate root layout, so this loads in full and starts from the session the API just set.
      router.push(`/portal/orders/${encodeURIComponent(placed.ref)}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) setTaken(true);
      else if (err instanceof ApiError && err.status === 400) {
        const paths = FIELDS.map(([, , path]) => path);
        const found = err.errorsFor(paths);
        setErrors(Object.fromEntries(Object.entries(found).map(([path, message]) => [FIELDS.find((f) => f[2] === path)?.[0] ?? "form", message])));
      } else toast.error(err instanceof ApiError && err.status === 429 ? err.message : "We couldn’t place the order. Try again.");
    }
  }

  if (!cart.length) {
    return (
      <main className="mk wrap">
        <div className="mk-head">
          <h1>Your cart is empty.</h1>
          <p className="lede">Add a product first, then come back to create your client.</p>
          <Link className="btn btn-blue" href="/marketplace">Back to the marketplace</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mk wrap">
      <div className="mk-head">
        <span className="kicker">Step 2 of 2</span>
        <h1>Create your client.</h1>
        <p className="lede">We&apos;ll set up your company and login, place this order, and take you to it.</p>
      </div>
      <form className="mk-layout" onSubmit={submit} noValidate>
        <section className="mk-form" aria-label="Your client details">
          {FIELDS.map(([key, label, , type = "text", autoComplete]) => (
            <label key={key} className="mk-field">
              <span>{label}{OPTIONAL.includes(key) && <small> Optional</small>}</span>
              <input
                className="mk-input"
                type={type}
                autoComplete={autoComplete}
                aria-invalid={!!errors[key] || undefined}
                value={form[key] ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
              {key === "password" && !errors.password && <small>{PASSWORD_HINT}</small>}
              {errors[key] && <span className="mk-err">{errors[key]}</span>}
            </label>
          ))}
        </section>
        <aside className="mk-cart" aria-label="Order summary">
          <h2>Your order</h2>
          {cart.map((l) => (
            <div key={l.productId} className="mk-line">
              <span>{l.productName}<small>{l.quantity.toLocaleString("en-US")} × {money(l.unitPriceUsd)}</small></span>
            </div>
          ))}
          <div className="mk-total"><span>Total</span><b>{money(cartTotal(cart))}</b></div>
          {errors.form && <p className="mk-err" role="alert">{errors.form}</p>}
          {taken && <p className="mk-err" role="alert">That email already has a login. <Link href="/signin">Sign in</Link> or use another email.</p>}
          <button className="btn btn-blue" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Placing…" : "Create client and place order"}
          </button>
          <Link className="btn btn-line" href="/marketplace">Back to cart</Link>
        </aside>
      </form>
    </main>
  );
}
