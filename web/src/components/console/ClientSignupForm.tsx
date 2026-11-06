"use client";

import Link from "next/link";
import { useState, type SubmitEvent } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";
import { PASSWORD_HINT, passwordProblem } from "@/lib/password";
import {
  ACCOUNT_TIERS,
  CLIENT_REGIONS,
  ORDER_CHANNELS,
  clientsApi,
  type Client,
  type ClientSignup,
  type ClientUser,
} from "@/lib/clients";

type Errors = Record<string, string>;

// No look-alikes (0/O, 1/l/I), so a password read off a screen or message is typed right the first time.
const READABLE = "abcdefghjkmnpqrstuvwxyz23456789";

// A starting password the admin passes on, in the same style as the ones the API generates: "k7mq-x2vd-9pwa-h4tn",
// 16 random characters (~79 bits), always with a letter and a number. The contact replaces it from their account page.
function generatePassword(): string {
  for (;;) {
    const chars = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => READABLE[b % READABLE.length]);
    const password = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
    if (!passwordProblem(password)) return password;
  }
}

function Field({ label, error, help, children }: { label: string; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {help && !error && <span className="help">{help}</span>}
      {error && <span className="ferr">{error}</span>}
    </label>
  );
}

// An admin signs up a new client company together with its first login. The contact signs in with the email and
// starting password and changes both under Account.
export default function ClientSignupForm() {
  const [form, setForm] = useState({
    clientName: "",
    region: CLIENT_REGIONS[0] as ClientSignup["region"],
    primaryOrderChannel: ORDER_CHANNELS[0] as ClientSignup["primaryOrderChannel"],
    accountTier: ACCOUNT_TIERS[2] as ClientSignup["accountTier"],
    slaPenaltyClause: false,
    annualRevenueUsd: "",
    contactName: "",
    contactEmail: "",
    contactPassword: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ client: Client; user: ClientUser; password: string } | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function validate(): Errors {
    const e: Errors = {};
    if (!form.clientName.trim()) e.clientName = "Enter the company name.";
    if (form.annualRevenueUsd && !(Number(form.annualRevenueUsd) >= 0)) e.annualRevenueUsd = "Enter an amount in US dollars.";
    if (!form.contactName.trim()) e["contact.name"] = "Enter the contact’s name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) e["contact.email"] = "Enter a valid email.";
    const pw = passwordProblem(form.contactPassword);
    if (pw) e["contact.password"] = pw;
    return e;
  }

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    try {
      const result = await clientsApi.signup({
        clientName: form.clientName.trim(),
        region: form.region,
        primaryOrderChannel: form.primaryOrderChannel,
        accountTier: form.accountTier,
        slaPenaltyClause: form.slaPenaltyClause,
        annualRevenueUsd: form.annualRevenueUsd ? Number(form.annualRevenueUsd) : null,
        contact: { name: form.contactName.trim(), email: form.contactEmail.trim(), password: form.contactPassword },
      });
      setCreated({ ...result, password: form.contactPassword });
      toast.success(`${result.client.clientName ?? result.client.clientId} signed up`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const { form, ...fields } = err.errorsFor([
          "clientName",
          "region",
          "primaryOrderChannel",
          "accountTier",
          "annualRevenueUsd",
          "contact.name",
          "contact.email",
          "contact.password",
        ]);
        setErrors(fields);
        if (form) toast.error(form);
      } else if (err instanceof ApiError && err.status === 409) setErrors({ "contact.email": err.message });
      else if (err instanceof ApiError) toast.error(`Halcyon couldn’t sign up this client: ${err.message}`);
      else toast.error("We couldn’t reach Halcyon. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <>
        <div className="page-h">
          <div>
            <p className="kick">Client signed up</p>
            <h1>{created.client.clientName}</h1>
            <p>
              Client <span className="mono">{created.client.clientId}</span> is active. Send these sign-in details to{" "}
              {created.user.name}; they can change the email and password under Account once signed in.
            </p>
          </div>
        </div>
        <section className="card" style={{ padding: 24, display: "grid", gap: 16, maxWidth: 560 }}>
          <dl className="kv" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px" }}>
            <dt className="muted">Sign in as</dt>
            <dd>Client</dd>
            <dt className="muted">Email</dt>
            <dd className="mono">{created.user.email}</dd>
            <dt className="muted">Starting password</dt>
            <dd className="mono">{created.password}</dd>
          </dl>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn btn-brand" href="/portal/clients">Back to clients</Link>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setCreated(null);
                setForm((f) => ({ ...f, clientName: "", annualRevenueUsd: "", contactName: "", contactEmail: "", contactPassword: "" }));
              }}
            >
              <Icon name="plus" />
              Sign up another
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="page-h">
        <div>
          <Link className="back" href="/portal/clients">
            <Icon name="arrow-left" />
            Clients
          </Link>
          <h1>Sign up a client</h1>
          <p>Adds the company to Halcyon and creates its first login.</p>
        </div>
      </div>

      <form className="card" onSubmit={onSubmit} noValidate style={{ padding: 24, display: "grid", gap: 24, maxWidth: 720 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 16 }}>
          <legend style={{ fontWeight: 600, marginBottom: 16 }}>Company</legend>
          <Field label="Company name" error={errors.clientName}>
            <input className="input" value={form.clientName} onChange={(e) => set("clientName", e.target.value)} aria-invalid={!!errors.clientName || undefined} />
          </Field>
          <div className="grid2">
            <Field label="Region" error={errors.region}>
              <select className="select" value={form.region} onChange={(e) => set("region", e.target.value as ClientSignup["region"])}>
                {CLIENT_REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Orders mostly by" error={errors.primaryOrderChannel}>
              <select
                className="select"
                value={form.primaryOrderChannel}
                onChange={(e) => set("primaryOrderChannel", e.target.value as ClientSignup["primaryOrderChannel"])}
              >
                {ORDER_CHANNELS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Account tier" error={errors.accountTier}>
              <select className="select" value={form.accountTier} onChange={(e) => set("accountTier", e.target.value as ClientSignup["accountTier"])}>
                {ACCOUNT_TIERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Annual revenue (USD)" error={errors.annualRevenueUsd} help="Optional">
              <input
                className="input"
                inputMode="numeric"
                value={form.annualRevenueUsd}
                onChange={(e) => set("annualRevenueUsd", e.target.value.replace(/[^\d.]/g, ""))}
                aria-invalid={!!errors.annualRevenueUsd || undefined}
              />
            </Field>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={form.slaPenaltyClause} onChange={(e) => set("slaPenaltyClause", e.target.checked)} />
            Contract has an SLA penalty clause
          </label>
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 16 }}>
          <legend style={{ fontWeight: 600, marginBottom: 16 }}>First login</legend>
          <div className="grid2">
            <Field label="Contact name" error={errors["contact.name"]}>
              <input className="input" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} aria-invalid={!!errors["contact.name"] || undefined} />
            </Field>
            <Field label="Contact email" error={errors["contact.email"]}>
              <input
                className="input"
                type="email"
                autoComplete="off"
                value={form.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                aria-invalid={!!errors["contact.email"] || undefined}
              />
            </Field>
          </div>
          <Field label="Starting password" error={errors["contact.password"]} help={PASSWORD_HINT}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input mono"
                autoComplete="new-password"
                value={form.contactPassword}
                onChange={(e) => set("contactPassword", e.target.value)}
                aria-invalid={!!errors["contact.password"] || undefined}
              />
              <button className="btn btn-secondary" type="button" onClick={() => set("contactPassword", generatePassword())} style={{ height: 40 }}>
                Generate
              </button>
            </div>
          </Field>
        </fieldset>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-brand" type="submit" disabled={pending} aria-busy={pending}>
            {pending && <Spinner />}
            {pending ? "Signing up…" : "Sign up client"}
          </button>
          <Link className="btn btn-secondary" href="/portal/clients">Cancel</Link>
        </div>
      </form>
    </>
  );
}
