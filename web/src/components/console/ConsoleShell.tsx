"use client";

import { ClientAttentionFeed } from "./requests/ClientRequests";
import ExceptionsFeed from "./requests/ExceptionsFeed";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";
import type { Principal, Role } from "@/lib/api";
import { signOut, useSession } from "@/lib/auth";
import { startPortal, type PortalEngine, type PortalNetwork, type PortalStatus } from "@/lib/portal/engine";
import { productsApi } from "@/lib/products";
import { settingsApi } from "@/lib/settings";
import { homeWarehouses, placeWarehouses, warehousesApi } from "@/lib/warehouses";
import CutoffClock from "./CutoffClock";
import UserMenu from "./UserMenu";

interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  roles: Role[];
  // The real count shown on the header bell for this item.
  badge?: "exceptions" | "messages";
  // Reached from the header bell only, not shown as a nav pill.
  bellOnly?: boolean;
  // Other pages this item is current on, e.g. the Clients tab of Users.
  also?: string[];
}

const STAFF: Role[] = ["admin", "contributor"];

const NAV: NavItem[] = [
  { href: "/portal", icon: "house", label: "Home", roles: ["client"] },
  { href: "/portal/products", icon: "cube", label: "Products", roles: ["client"] },
  { href: "/portal/orders", icon: "package", label: "Orders", roles: ["client"] },
  { href: "/portal/messages", icon: "bell", label: "Messages", roles: ["client"], badge: "messages", bellOnly: true },
  { href: "/portal", icon: "squares-four", label: "Today", roles: STAFF },
  { href: "/portal/orders", icon: "package", label: "Orders", roles: STAFF },
  { href: "/portal/exceptions", icon: "warning", label: "Exceptions", roles: STAFF, badge: "exceptions", bellOnly: true },
  { href: "/portal/emails", icon: "bell", label: "Emails", roles: STAFF },
  { href: "/portal/inventory", icon: "warehouse", label: "Inventory", roles: STAFF },
  { href: "/portal/carriers", icon: "truck", label: "Carriers", roles: STAFF },
  { href: "/portal/insights", icon: "chart-bar", label: "Insights", roles: STAFF },
  // Users has Staff (/portal/team, admin only) and Clients (/portal/clients) tabs; contributors only get Clients.
  { href: "/portal/team", icon: "users", label: "Users", roles: ["admin"], also: ["/portal/clients"] },
  { href: "/portal/clients", icon: "users", label: "Users", roles: ["contributor"] },
];

const SPEEDS = [1, 4, 12, 48, 240];

const UserContext = createContext<Principal | null>(null);
const EngineContext = createContext<{ engine: PortalEngine | null; failed: boolean; status: PortalStatus | null }>({
  engine: null,
  failed: false,
  status: null,
});

// The signed-in user, for components rendered inside <ConsoleShell>.
export function useConsoleUser(): Principal {
  const user = useContext(UserContext);
  if (!user) throw new Error("useConsoleUser must be used inside <ConsoleShell>");
  return user;
}

// The running portal engine (null while the network loads, and always for non-admins), whether loading it failed, and
// its latest status. Only the admin-only Simulation pages use it.
export const usePortalEngine = () => useContext(EngineContext);

// Renders children only for a signed-in user whose role is in `roles`.
export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useConsoleUser();
  if (roles.includes(user.role)) return children;
  return (
    <div className="card empty" role="alert">
      <Icon name="lock-simple" className="lg" />
      You don’t have access to this page.
    </div>
  );
}

async function loadNetwork(): Promise<PortalNetwork> {
  // The settings only give the demo clock its zone; without them it keeps the browser's.
  const [warehouseList, productList, settings] = await Promise.all([
    warehousesApi.list(),
    productsApi.list(),
    settingsApi.get().catch(() => null),
  ]);
  const warehouses = placeWarehouses(warehouseList.warehouses);
  return { warehouses, homeOf: homeWarehouses(warehouses), products: productList.products, timeZone: settings?.delivery.timeZone };
}

const noSubscribe = () => () => {};
const noStatus = () => null;

// The /portal layout: session gate and header around every portal page, and the demo clock footer on the Simulation
// pages only. For admins it also loads the warehouses and products and runs the portal engine, so the simulation keeps
// going as they move between pages; only /portal/simulation/* draws it (<EngineView/>). Every other page shows real
// data, and the header bell counts real orders. Anonymous visitors go to /signin.
export default function ConsoleShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const user = session.user;
  const [network, setNetwork] = useState<PortalNetwork | null>(null);
  const [failed, setFailed] = useState(false);
  const [engine, setEngine] = useState<PortalEngine | null>(null);
  const [counts, setCounts] = useState({ exceptions: 0, messages: 0 });
  const countExceptions = useCallback((n: number) => setCounts((c) => (c.exceptions === n ? c : { ...c, exceptions: n })), []);
  const countMessages = useCallback((n: number) => setCounts((c) => (c.messages === n ? c : { ...c, messages: n })), []);
  const routerRef = useRef(router);
  // The simulation is for admins only (the Simulation pages and /api/simulation refuse everyone else).
  const simulates = user?.role === "admin";

  useEffect(() => {
    routerRef.current = router;
    if (session.status === "unauthenticated") router.replace("/signin");
  }, [session.status, router]);

  useEffect(() => {
    if (!user || !simulates) return;
    let active = true;
    loadNetwork().then(
      (loaded) => active && setNetwork(loaded),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [user, simulates]);

  useEffect(() => {
    if (!user || !network || !simulates) return;
    const started = startPortal(
      {
        role: user.type === "staff" ? "admin" : "client",
        canEditRules: user.role === "admin",
        name: user.name,
        company: user.client?.clientName ?? undefined,
        clientId: user.client?.clientId,
      },
      network,
      (path) => routerRef.current.push(path),
    );
    setEngine(started);
    return () => {
      started.dispose();
      setEngine(null);
    };
  }, [user, network, simulates]);

  const status: PortalStatus | null = useSyncExternalStore(
    engine?.subscribe ?? noSubscribe,
    engine?.status ?? noStatus,
    noStatus,
  );

  if (!user) return <div aria-busy="true" />;

  const onSignOut = () =>
    void signOut().finally(() => {
      toast.success("Signed out");
      router.replace("/signin");
    });

  const nav = NAV.filter((item) => item.roles.includes(user.role));
  // The deepest item containing this page is the current one: /portal/orders/new is under Orders.
  const depth = (item: NavItem) =>
    Math.max(
      -1,
      ...[item.href, ...(item.also ?? [])]
        .filter((href) => pathname === href || (href !== "/portal" && pathname.startsWith(`${href}/`)))
        .map((href) => href.length),
    );
  const current = nav
    .filter((item) => depth(item) >= 0)
    .sort((a, b) => depth(b) - depth(a))[0];
  const bell = user.type === "staff" ? nav.find((item) => item.badge === "exceptions") : nav.find((item) => item.badge === "messages");

  return (
    <UserContext.Provider value={user}>
      <EngineContext.Provider value={{ engine, failed, status }}>
        <a className="skip" href="#main">Skip to content</a>
        <div className="app">
          <header className="hdr">
            <Link className="brand" href="/portal">
              <span className="brand-mark"><Icon name="package" /></span>
              <span className="brand-name">Halcyon</span>
            </Link>
            <nav className="pills" aria-label="Main navigation">
              {nav.filter((item) => !item.bellOnly).map((item) => {
                const count = item.badge ? counts[item.badge] : 0;
                return (
                  <Link key={item.href} className="pill" href={item.href} aria-current={item === current ? "page" : undefined}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    {count ? <span className="badge">{count}</span> : null}
                  </Link>
                );
              })}
            </nav>
            <div className="hdr-r">
              {STAFF.includes(user.role) && <CutoffClock />}
              {bell && (
                <Link className="iconbtn" href={bell.href} aria-label={bell.label}>
                  <Icon name="bell" className="lg" />
                  <span className="dotb" hidden={!(bell.badge && counts[bell.badge])}></span>
                </Link>
              )}
              <UserMenu user={user} onSignOut={onSignOut} />
            </div>
          </header>

          <main className="main" id="main">{children}</main>
          <ClientAttentionFeed onCount={countMessages} />
          <ExceptionsFeed onCount={countExceptions} />

          {status && pathname.startsWith("/portal/simulation") && (
            <footer className="dock" role="group" aria-label="Demo clock">
              <span className="demo-tag">Demo clock</span>
              <span className="live" data-paused={status.paused ? "" : undefined}>
                <span className="live-dot"></span>
                <span className="mono">
                  {status.clock} {status.zone}
                </span>
                {status.waitingOnAgents && <span> · waiting on agents</span>}
              </span>
              <span className="chip" title="The clock stops at the end of each simulated week and writes its report on this page">
                Week {status.week}
                {status.runTo ? ` of ${status.runTo}` : ""} · day {status.weekDay}/7
              </span>
              {status.agents && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  aria-pressed={status.runMode === "agents"}
                  title={
                    status.runMode === "agents"
                      ? "Stop the agent run at the end of this week"
                      : "Run up to 2 weeks with the AI agents; the clock waits for every call, so none is skipped"
                  }
                  onClick={() => engine?.runAgents()}
                >
                  {status.runMode === "agents" ? "Stop agents" : "Agent run"}
                </button>
              )}
              <button
                className="btn btn-secondary"
                type="button"
                aria-pressed={status.runMode === "months"}
                title={status.runMode === "months" ? "Stop the long run at the end of this week" : "Run 5 months non-stop, writing each week's report as it ends"}
                onClick={() => engine?.runMonths(5)}
              >
                {status.runMode === "months" ? "Stop run" : "5 months"}
              </button>
              <button
                className="btn btn-secondary btn-icon"
                type="button"
                aria-label={`${status.paused ? "Resume" : "Pause"} live data`}
                onClick={() => engine?.togglePause()}
              >
                <Icon name={status.paused ? "play" : "pause"} />
              </button>
              <div className="seg mono" role="group" aria-label="Simulation speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={status.speed === s} onClick={() => engine?.setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
            </footer>
          )}
        </div>

        <dialog className="dlg" data-composer aria-labelledby="cmp-title">
          <div className="dlg-b">
            <div>
              <h2 id="cmp-title">Email an order</h2>
              <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>
                Sends an email to <span className="mono">orders@halcyonlogistics.com</span>. It’s read automatically the moment it lands.
              </p>
            </div>
            <label className="field">
              Message
              <textarea className="textarea" data-cmp-body spellCheck={false} aria-describedby="cmp-hint cmp-err"></textarea>
            </label>
            <p className="field help" id="cmp-hint" style={{ display: "block" }}>
              Delete the ZIP code to watch the address check hold the order and ask you for it.
            </p>
            <p className="ferr" id="cmp-err" data-cmp-err hidden></p>
            <div className="dlg-acts">
              <button className="btn btn-secondary" type="button" data-cmp-cancel>Cancel</button>
              <button className="btn btn-primary" type="button" data-cmp-send>Send email</button>
            </div>
          </div>
        </dialog>
      </EngineContext.Provider>
    </UserContext.Provider>
  );
}
