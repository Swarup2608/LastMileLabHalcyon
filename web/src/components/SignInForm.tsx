"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type Realm } from "@/lib/api";
import { authApi, signIn, useSession, type DemoAccount } from "@/lib/auth";
import Icon from "./Icon";
import Spinner from "./Spinner";
import NetworkMap from "./NetworkMap";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_LABEL = { admin: "Admin", contributor: "Contributor", client: "Client" } as const;
const ROLE_CHIP = { admin: "pri", contributor: "blue", client: "ok" } as const;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

const REALMS: [Realm, string][] = [
  ["client", "Client"],
  ["staff", "Halcyon staff"],
];

function messageFor(err: unknown) {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Email or password is incorrect.";
    if (err.status === 429) return "Too many sign-in attempts. Try again in a few minutes.";
    if (err.status === 400) return "Check your email and password.";
  }
  return "We couldn’t reach Halcyon. Check your connection and try again.";
}

// Where to go after signing in: the portal page the route guard (src/proxy.ts) sent the visitor here from, else
// /portal. Only plain /portal paths are accepted, so ?next= can't send anyone to another site.
function destination() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && /^\/portal(\/[\w-]+)*$/.test(next) ? next : "/portal";
}

export default function SignInForm() {
  const router = useRouter();
  const session = useSession();
  const [realm, setRealm] = useState<Realm>("client");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ field: "email" | "password"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [demos, setDemos] = useState<DemoAccount[]>([]);
  // Which demo button is signing in, so only that one shows the spinner.
  const [signingInAs, setSigningInAs] = useState<string | null>(null);

  // Accounts an admin marked as demo. Optional extras: if the list can't load, the form still works.
  useEffect(() => {
    let active = true;
    authApi.demoAccounts().then(
      ({ accounts }) => active && setDemos(accounts),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  // Already signed in (the access cookie may just have expired and been renewed from the refresh cookie): skip the form.
  useEffect(() => {
    if (session.status === "authenticated") router.replace(destination());
  }, [session.status, router]);

  const fail = (field: "email" | "password", text: string) => {
    setError({ field, text });
    (field === "email" ? emailRef : passwordRef).current?.focus();
  };

  // A demo button is the normal login with that account's email and password filled in.
  async function signInAs(demo: DemoAccount) {
    setRealm(demo.realm);
    setEmail(demo.email);
    setPassword(demo.password);
    setError(null);
    setPending(true);
    setSigningInAs(demo.email);
    try {
      await signIn(demo.realm, demo.email, demo.password);
      router.replace(destination());
    } catch (err) {
      setPending(false);
      setSigningInAs(null);
      fail("password", messageFor(err));
    }
  }

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    setError(null);
    if (!EMAIL_RE.test(address)) return fail("email", "Enter a valid work email.");
    if (!password) return fail("password", "Enter your password.");

    setPending(true);
    try {
      await signIn(realm, address, password);
      router.replace(destination());
    } catch (err) {
      setPending(false);
      fail("password", messageFor(err));
    }
  }

  return (
    <main className="login" id="main">
      <section className="login-art" aria-label="About Halcyon">
        <div className="brand">
          <span className="brand-mark"><Icon name="package" /></span>
          <span className="brand-name">Halcyon</span>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <h1>Every order, from inbox to doorstep.</h1>
          <p>
            Clients see their stock and track every delivery. Operations sees every order the moment it lands, and fixes
            problems before they become late deliveries.
          </p>
        </div>
        <div className="login-map">
          <NetworkMap />
        </div>
        <div className="login-facts">
          <div><span className="n">280</span><span className="l">enterprise clients</span></div>
          <div><span className="n">5</span><span className="l">warehouses</span></div>
          <div><span className="n">6</span><span className="l">carriers</span></div>
        </div>
      </section>

      <section className="login-pane">
        <div className="login-card">
          <div>
            <h2>Sign in to Halcyon</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>
              {demos.length
                ? "Pick a demo account below, or use the login your Halcyon account manager gave you."
                : "Use the login your Halcyon account manager or administrator gave you."}
            </p>
          </div>

          {demos.length > 0 && (
            <>
              <div className="demo-accts" role="group" aria-label="Demo accounts">
                {demos.map((demo) => (
                  <button
                    key={`${demo.realm}:${demo.email}`}
                    className="acct"
                    type="button"
                    disabled={pending}
                    aria-busy={signingInAs === demo.email}
                    onClick={() => signInAs(demo)}
                  >
                    <span className="avatar" style={{ background: demo.realm === "staff" ? "#0B6E77" : "#1D6FD1" }}>
                      {initialsOf(demo.name)}
                    </span>
                    <span className="who">
                      {demo.name}
                      <span>{demo.clientName ?? demo.email}</span>
                    </span>
                    {signingInAs === demo.email ? (
                      <span style={{ marginLeft: "auto", display: "flex" }}><Spinner /></span>
                    ) : (
                      <span className={`chip ${ROLE_CHIP[demo.role]}`}>{ROLE_LABEL[demo.role]}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="or">or</div>
            </>
          )}

          <form onSubmit={onSubmit} noValidate>
            <div className="seg" role="group" aria-label="Account type">
              {REALMS.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={realm === value} onClick={() => setRealm(value)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="field">
              Work email
              <input
                ref={emailRef}
                className="input"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error?.field === "email" || undefined}
                aria-describedby="lerr"
              />
            </label>
            <label className="field">
              Password
              <input
                ref={passwordRef}
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error?.field === "password" || undefined}
                aria-describedby="lerr"
              />
            </label>
            <p className="ferr" id="lerr" role="alert" hidden={!error}>
              {error?.text}
            </p>
            <button className="btn btn-brand btn-lg" type="submit" disabled={pending} aria-busy={pending && !signingInAs}>
              {pending && !signingInAs ? <Spinner /> : <Icon name="lock-simple" />}
              {pending && !signingInAs ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="foot">Prototype for Last Mile Labs. All orders, clients and people are synthetic.</p>
        </div>
      </section>
    </main>
  );
}
