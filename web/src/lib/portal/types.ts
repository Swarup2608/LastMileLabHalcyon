// The portal engine's public types and the page each engine view lives on.
import type { Product } from "../products";

export interface PortalUser {
  // `admin` is the operations console (admins and contributors); `client` the client portal.
  role: "client" | "admin";
  // Only admins see and change the simulation's rules; contributors work the console without them.
  canEditRules?: boolean;
  name: string;
  // The signed-in client's company name.
  company?: string;
  // The signed-in client's id in the database; its products are the ones the client portal shows.
  clientId?: string;
}

// What the layout's header and demo clock show, refreshed as the simulation runs.
export interface PortalStatus {
  clock: string;
  paused: boolean;
  speed: number;
  // The simulated week the clock is in (it stops at the end of each) and its day, 1 to 7.
  week: number;
  weekDay: number;
  // The last week of a run that carries on through the week ends, 0 when there is none, and which run: "months"
  // (runMonths) or "agents" (runAgents, waitingOnAgents while the clock is held for an agent call).
  runTo: number;
  runMode: "" | "months" | "agents";
  // The demo clock's zone, short: "EDT".
  zone: string;
  waitingOnAgents: boolean;
  // Staff with the live agents, who can start an agent run.
  agents: boolean;
  // Exceptions waiting on operations, and orders held for the client's input.
  exceptions: number;
  messages: number;
  // Orders sent from a farther warehouse today because the nearest was out of stock, for the Inventory page.
  stockoutsToday: number;
  weeklyAllocation: boolean;
}

// A real order request the signed-in client emailed (from the API), for the client's Messages and its badge. Built by
// components/console/requests/ClientRequests.tsx; the Orders list itself is React (components/console/OrdersView.tsx).
export interface EmailedOrder {
  // The request's ref, "REQ-A73DEA"; its page is /portal/orders/<id>.
  id: string;
  items: string;
  // Waiting on the client's answers.
  attn: boolean;
  // What Halcyon has told the client about it: warn needs their action, ok is good news.
  messages: { at: string; text: string; kind: "warn" | "ok" | "" }[];
}

// A simulated order held at the address check, for the Exceptions page's Address issues card (React).
export interface AddressHold {
  id: string;
  client: string;
  channel: "email" | "edi" | "api" | "portal";
  // "ZIP code" or "unit number".
  missing: string;
  address: string;
  // Epoch ms on the demo clock.
  since: number;
  // The validated value releaseAddress() fills in.
  suggestion: string;
}

// One simulated order as the Orders page (React) lists it, from orderRows().
export interface SimOrderRow {
  id: string;
  client: string;
  product: string;
  sku: string;
  qty: number;
  channel: "email" | "edi" | "api" | "portal";
  // Epoch ms on the demo clock: when the client placed it, and its intake (accepted and released to a warehouse), null
  // while it's still being read or held at the address check.
  arrival: number;
  intake: number | null;
  // The full ship-to address.
  address: string;
  status: string;
  // The engine's chip tone: "warn", "bad", "ok", "blue", "pri" or "".
  tone: string;
  held: boolean;
  delayed: boolean;
  delivered: boolean;
  // Where it ships from and to, and how far.
  from: string;
  to: string;
  distance: string;
  warehouse: string | null;
  carrier: string | null;
  // 0 to 1.
  progress: number;
  // "Wed 29 Oct", or null before it's promised; late when a delay pushed it.
  promise: string | null;
  late: boolean;
}

export interface PortalEngine {
  // Renders `view` (with `param`, an order id for "order") into el; the returned function stops rendering there.
  show(el: HTMLElement, view: string, param?: string): () => void;
  subscribe(listener: () => void): () => void;
  status(): PortalStatus;
  togglePause(): void;
  setSpeed(speed: number): void;
  // Starts a non-stop run of `months` that writes each week's report as it ends; called again, stops it at this week's end.
  runMonths(months: number): void;
  // Staff: runs this week and the next with the live agents, the clock waiting for every call; called again, stops it.
  runAgents(): void;
  // Replaces the client's emailed orders shown in Messages and its badge.
  setEmailed(orders: EmailedOrder[]): void;
  // Staff: the number of emailed orders on the Exceptions page, for its badge.
  setEmailExceptions(count: number): void;
  // Staff: simulated orders held at the address check, oldest first; releaseAddress fills in the validated value.
  addressHolds(): AddressHold[];
  releaseAddress(id: string): void;
  // The simulated orders the signed-in user sees (the client's own, or all for staff), newest first.
  orderRows(): SimOrderRow[];
  dispose(): void;
}

// The page each engine view lives on: all under the admin-only Simulation, so simulated data never reaches a real page.
// The client views (products, new, messages) have no page of their own any more and land on the Simulation.
const SIM = "/portal/simulation";
const VIEW_PATH: Record<string, string> = {
  overview: SIM,
  orders: `${SIM}/orders`,
  exceptions: `${SIM}/exceptions`,
  carriers: `${SIM}/carriers`,
  rules: `${SIM}/rules`,
};
export const viewPath = (view: string, param?: string) =>
  view === "order" && param ? `${SIM}/orders/${encodeURIComponent(param)}` : VIEW_PATH[view] ?? SIM;

export interface PortalNetwork {
  // The warehouses from the database, placed on the map (see lib/warehouses.ts).
  warehouses: { id: string; name: string; region: string; at: [number, number] }[];
  // Delivery region -> the warehouse that ships there by default.
  homeOf: Record<string, string>;
  // Products with their stock per warehouse, from the database (see lib/products.ts). Staff get every client's.
  products: Product[];
  // The IANA zone of the same-day cutoff (settings); the demo clock starts at the current time there. Unset: the browser's.
  timeZone?: string;
}
