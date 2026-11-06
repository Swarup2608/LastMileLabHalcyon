// The simulation's live agents: while the demo clock runs, the engine hands this what happens (an order email arrives,
// the 08:00 cutoff passes, a warehouse runs short, the weekly allocation) and the real Foundry agents are asked about
// it through /api/simulation. The agents get the simulation's own orders, stock and demand; only the warehouses, products
// and carrier figures are the real ones, and nothing is read from or saved to the real orders or stock. What each agent
// says goes to the feed (components/AgentFeed.tsx) and, for the carrier and allocation agents, back into the simulation.
import { parseReport } from "../carrier-plan";
import { readReply } from "../emails";
import type { Transfer } from "../rebalance";
import { simulationApi, type SimulatedStock } from "../simulation";

export type AgentName = "Email agent" | "Carrier agent" | "Allocation agent" | "Stock-out handling";
export const AGENTS: AgentName[] = ["Email agent", "Carrier agent", "Allocation agent", "Stock-out handling"];

export interface FeedItem {
  id: number;
  agent: AgentName;
  // working: waiting on the agent. warn: it answered, but the validator or the data had something to say.
  state: "working" | "done" | "warn" | "failed";
  title: string;
  detail?: string;
  // The demo clock when it started.
  clock: string;
  // How long the agent took, ms.
  took?: number;
}

export interface AgentStats {
  calls: number;
  failed: number;
  // Events that came while the agent was busy and were left out, to keep the calls (and the bill) down.
  skipped: number;
}

export interface FeedState {
  enabled: boolean;
  items: FeedItem[];
  stats: Record<AgentName, AgentStats>;
}

const MAX_ITEMS = 40;
const emptyStats = (): Record<AgentName, AgentStats> => ({
  "Email agent": { calls: 0, failed: 0, skipped: 0 },
  "Carrier agent": { calls: 0, failed: 0, skipped: 0 },
  "Allocation agent": { calls: 0, failed: 0, skipped: 0 },
  "Stock-out handling": { calls: 0, failed: 0, skipped: 0 },
});

let enabled = true;
try {
  enabled = localStorage.getItem("halcyon.liveAgents") !== "off";
} catch {}
let state: FeedState = { enabled, items: [], stats: emptyStats() };
let seq = 0;
const listeners = new Set<() => void>();
const set = (next: Partial<FeedState>) => {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
};

// For useSyncExternalStore: the feed outlives the engine, so the page shows the last run until the next one starts.
export const agentFeed = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  snapshot: () => state,
  setEnabled(on: boolean) {
    try {
      localStorage.setItem("halcyon.liveAgents", on ? "on" : "off");
    } catch {}
    set({ enabled: on });
  },
  clear: () => set({ items: [], stats: emptyStats() }),
};

const add = (item: Omit<FeedItem, "id">) => {
  const full = { ...item, id: ++seq };
  set({ items: [full, ...state.items].slice(0, MAX_ITEMS) });
  return full.id;
};
const update = (id: number, patch: Partial<FeedItem>) => set({ items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
const count = (agent: AgentName, key: keyof AgentStats) => {
  if (key !== "calls") week[key][agent]++;
  set({ stats: { ...state.stats, [agent]: { ...state.stats[agent], [key]: state.stats[agent][key] + 1 } } });
};

// What the agents did in the simulated week so far, for the week's report. The engine takes it when the week ends.
export interface WeekAgents {
  email: { read: number; lines: number; flagged: number };
  carrier: {
    plans: number;
    orders: number;
    cleared: number;
    review: number;
    // Plans the validator refused: nothing was dispatched from them.
    rejected: number;
    // Region → carrier → plans that chose it.
    picks: Record<string, Record<string, number>>;
    // Region → the highest risk the agent rated an order going there.
    risk: Record<string, string>;
  };
  allocation: { runs: number; products: number; suggested: number; moved: number; unchanged: number; notes: string[] };
  stockouts: { rerouted: number; products: string[] };
  failed: Record<AgentName, number>;
  skipped: Record<AgentName, number>;
}
const newWeek = (): WeekAgents => ({
  email: { read: 0, lines: 0, flagged: 0 },
  carrier: { plans: 0, orders: 0, cleared: 0, review: 0, rejected: 0, picks: {}, risk: {} },
  allocation: { runs: 0, products: 0, suggested: 0, moved: 0, unchanged: 0, notes: [] },
  stockouts: { rerouted: 0, products: [] },
  failed: { "Email agent": 0, "Carrier agent": 0, "Allocation agent": 0, "Stock-out handling": 0 },
  skipped: { "Email agent": 0, "Carrier agent": 0, "Allocation agent": 0, "Stock-out handling": 0 },
});
let week = newWeek();
const RISK = ["LOW", "MODERATE", "HIGH"];

const message = (err: unknown) => (err instanceof Error ? err.message : "Request failed");
const short = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// The simulation's regions are the dataset's four, plus "South", which the dataset counts in the Southeast.
const apiRegion = (r: string) => (r === "South" ? "Southeast" : r);
const carrierLetter = (c: string | null) => /^(?:carrier\s+)?([A-F])$/i.exec(c?.trim() ?? "")?.[1].toUpperCase() ?? null;

// What the engine gives to, and takes from, the agents.
export interface LiveHost {
  clock(): string;
  // The simulation's stock and demand for a product right now.
  snapshot(productId: string): SimulatedStock | null;
  warehouseName(id: string): string;
  // A carrier the agent chose for a region; used for the orders planned after it.
  setCarrier(region: string, carrier: string): void;
  // Moves cartons between the simulated warehouses (never the database); returns how many moved.
  applyTransfers(productId: string, transfers: Pick<Transfer, "source" | "destination" | "quantity">[]): number;
}

export interface CutoffOrder {
  id: string;
  warehouse: string | null;
  city: string;
  state: string;
  region: string;
}

export interface LiveAgents {
  onEmail(mail: { from: string; subject: string; body: string }): void;
  onCutoff(orders: CutoffOrder[]): void;
  onStockout(e: { productId: string; productName: string; orderId: string; qty: number; nearest: string; shippedFrom: string; day: number }): void;
  onWeeklyAllocation(products: { id: string; name: string }[]): void;
  // Waiting mode, for the agent run: every event is queued (none skipped, even with the feed switched off), a failed
  // call is tried once more, and the engine holds the clock while busy() says calls are queued or running.
  setWaiting(on: boolean): void;
  busy(): boolean;
  // What the agents did since the last call, and starts the next week's count.
  takeWeek(): WeekAgents;
  dispose(): void;
}

// One agent works on one thing at a time; what arrives meanwhile waits, up to `room` (no limit while `waiting()`),
// and the rest is skipped. `pending` counts the lane's queued and running jobs.
const lane = (agent: AgentName, room: number, waiting: () => boolean, pending: (n: number) => void) => {
  let busy = false;
  const queue: (() => Promise<void>)[] = [];
  const next = async () => {
    const job = queue.shift();
    if (!job) {
      busy = false;
      return;
    }
    await job();
    pending(-1);
    void next();
  };
  return (job: () => Promise<void>) => {
    if (busy && queue.length >= room && !waiting()) return count(agent, "skipped");
    pending(1);
    queue.push(job);
    if (!busy) {
      busy = true;
      void next();
    }
  };
};

export function createLiveAgents(host: LiveHost): LiveAgents {
  let alive = true;
  let waiting = false;
  let pending = 0;
  const up = () => alive && (waiting || agentFeed.snapshot().enabled);
  agentFeed.clear();
  week = newWeek();

  // Which agents the API has; one that isn't there is said once and left out.
  const available: Promise<{ carrier: boolean; email: boolean; allocation: boolean }> = simulationApi
    .status()
    .catch(() => ({ carrier: false, email: false, allocation: false }));
  void available.then((a) => {
    if (!alive) return;
    if (!a.email) add({ agent: "Email agent", state: "warn", title: "Not configured on the API", detail: "Order emails are simulated without it.", clock: host.clock() });
    if (!a.allocation) add({ agent: "Allocation agent", state: "warn", title: "Not configured on the API", detail: "Stock is topped up by the built-in rule.", clock: host.clock() });
    if (!a.carrier) add({ agent: "Carrier agent", state: "warn", title: "Not configured on the API", detail: "Carriers follow the built-in lanes.", clock: host.clock() });
  });

  // Runs one agent call as a feed item: working, then what came of it.
  const work = async (agent: AgentName, title: string, call: () => Promise<{ state?: "done" | "warn"; detail?: string }>) => {
    const id = add({ agent, state: "working", title, clock: host.clock() });
    const t0 = performance.now();
    count(agent, "calls");
    try {
      // While waiting, a call that fails is tried once more before it counts as failed.
      const r = await call().catch((err) => (waiting && alive ? call() : Promise.reject(err)));
      if (alive) update(id, { state: r.state ?? "done", detail: r.detail, took: performance.now() - t0 });
    } catch (err) {
      count(agent, "failed");
      if (alive) update(id, { state: "failed", detail: message(err), took: performance.now() - t0 });
    }
  };

  const isWaiting = () => waiting;
  const track = (n: number) => void (pending += n);
  const emailLane = lane("Email agent", 1, isWaiting, track);
  const carrierLane = lane("Carrier agent", 1, isWaiting, track);
  const allocationLane = lane("Allocation agent", 4, isWaiting, track);
  const askedToday = new Set<string>();

  // Asks the allocation agent, then moves the cartons it recommends, in the simulation only.
  // The stock and demand are taken now, as the agent should see them, not when its turn comes.
  const rebalance = (title: string, products: { id: string; name: string }[]) => {
    const sent = products.flatMap((p) => host.snapshot(p.id) ?? []);
    if (!sent.length) return;
    allocationLane(() =>
      work("Allocation agent", title, async () => {
        if (!(await available).allocation) return { state: "warn", detail: "Skipped: agent not configured." };
        const { input, plan, warnings } = await simulationApi.rebalance(sent);
        // The agent answers by SKU; the input it was given says which product that is.
        const idOf = new Map(input.products.map((p) => [p.product, p.productId]));
        let moved = 0;
        let units = 0;
        const detail: string[] = [];
        for (const s of plan.products) {
          if (!s.recommendedTransfers.length) {
            week.allocation.unchanged++;
            detail.push(`${s.product}: ${s.decision === "NO" ? "no move needed" : s.decision.toLowerCase()}`);
            continue;
          }
          detail.push(
            `${s.product}: ${s.recommendedTransfers.map((t) => `${t.quantity} ${host.warehouseName(t.source)} → ${host.warehouseName(t.destination)}`).join(", ")}`,
          );
          moved += s.recommendedTransfers.reduce((n, t) => n + t.quantity, 0);
          const productId = idOf.get(s.product);
          if (productId) units += host.applyTransfers(productId, s.recommendedTransfers);
        }
        week.allocation.runs++;
        week.allocation.products += plan.products.length;
        week.allocation.suggested += moved;
        week.allocation.moved += units;
        for (const s of plan.products) if (s.recommendedTransfers.length && week.allocation.notes.length < 4) week.allocation.notes.push(detail.find((d) => d.startsWith(`${s.product}:`)) ?? s.product);
        const note = warnings.length ? ` Warnings: ${warnings[0]}` : "";
        return {
          state: warnings.length ? "warn" : "done",
          detail: short(`${moved ? `${moved} cartons suggested, ${units} moved in the simulation. ` : ""}${detail.join("; ")}.${note}`, 320),
        };
      }),
    );
  };

  return {
    onEmail(mail) {
      if (!up()) return;
      emailLane(() =>
        work("Email agent", `Reading "${short(mail.subject, 60)}" from ${mail.from.split("<")[0].trim()}`, async () => {
          if (!(await available).email) return { state: "warn", detail: "Skipped: agent not configured." };
          const { output } = await simulationApi.email(mail);
          const r = readReply(output);
          const lines = r.products.length;
          week.email.read++;
          week.email.lines += lines;
          if (r.missing.length) week.email.flagged++;
          return r.missing.length
            ? { state: "warn", detail: `${lines} product line${lines === 1 ? "" : "s"} read; missing ${r.missing.join(", ")}. The client would be asked.` }
            : { detail: `${lines} product line${lines === 1 ? "" : "s"} and the full delivery address read.` };
        }),
      );
    },

    onCutoff(orders) {
      if (!up() || !orders.length) return;
      carrierLane(() =>
        work("Carrier agent", `08:00 cutoff: planning ${orders.length} same-day orders`, async () => {
          if (!(await available).carrier) return { state: "warn", detail: "Skipped: agent not configured." };
          const { report, check } = await simulationApi.carrier(
            orders.map((o) => ({ orderId: o.id, warehouseName: o.warehouse, destination: `${o.city}, ${o.state}`, region: apiRegion(o.region) as never })),
          );
          const plan = parseReport(report);
          week.carrier.plans++;
          week.carrier.orders += orders.length;
          if (!plan) return { state: "warn", detail: short(`Reply wasn't a plan: ${report}`) };
          // Each region goes to the carrier the agent assigned most of its dispatch-ready orders to.
          const votes = new Map<string, Map<string, number>>();
          if (!check.errors.length)
            for (const c of plan.orders) {
              const carrier = carrierLetter(c.assigned);
              const o = orders.find((x) => x.id === c.id);
              if (!carrier || !o || !c.dispatch_ready) continue;
              const v = votes.get(o.region) ?? new Map<string, number>();
              v.set(carrier, (v.get(carrier) ?? 0) + 1);
              votes.set(o.region, v);
            }
          const picks: string[] = [];
          for (const [region, v] of votes) {
            const [carrier] = [...v].sort((a, b) => b[1] - a[1])[0];
            host.setCarrier(region, carrier);
            picks.push(`${region} → ${carrier}`);
          }
          week.carrier.cleared += check.dispatch.length;
          week.carrier.review += plan.summary.review_order_ids.length;
          for (const c of plan.orders) {
            const o = orders.find((x) => x.id === c.id);
            const risk = c.risk?.toUpperCase();
            if (o && risk && RISK.indexOf(risk) > RISK.indexOf(week.carrier.risk[o.region] ?? "")) week.carrier.risk[o.region] = risk;
          }
          for (const [region, v] of votes) {
            const picks = (week.carrier.picks[region] ??= {});
            const [carrier] = [...v].sort((a, b) => b[1] - a[1])[0];
            picks[carrier] = (picks[carrier] ?? 0) + 1;
          }
          if (check.errors.length) week.carrier.rejected++;
          if (check.errors.length) return { state: "warn", detail: short(`Plan failed validation, nothing dispatched: ${check.errors[0]}`) };
          const review = plan.summary.review_order_ids.length;
          return {
            state: review ? "warn" : "done",
            detail: `${check.dispatch.length} of ${orders.length} cleared for dispatch${review ? `, ${review} need review` : ""}. ${picks.length ? `Carriers now: ${picks.join(", ")}.` : ""}`,
          };
        }),
      );
    },

    onStockout(e) {
      if (!up()) return;
      count("Stock-out handling", "calls");
      week.stockouts.rerouted++;
      if (!week.stockouts.products.includes(e.productName) && week.stockouts.products.length < 5) week.stockouts.products.push(e.productName);
      add({
        agent: "Stock-out handling",
        state: "done",
        title: `${e.productName} short at ${host.warehouseName(e.nearest)}`,
        detail: `${e.orderId} (${e.qty} cartons) ships from ${host.warehouseName(e.shippedFrom)} instead; logged for the ${waiting ? "next rebalance" : "allocation agent"}.`,
        clock: host.clock(),
      });
      // In an agent run the product waits for the next twice-weekly rebalance. Otherwise the agent is asked now, at most
      // once a product a day, so a busy shelf doesn't ask it for every order.
      if (waiting) return;
      const key = `${e.productId}|${e.day}`;
      if (askedToday.has(key)) return;
      askedToday.add(key);
      rebalance(`Stock-out: rebalancing ${e.productName}`, [{ id: e.productId, name: e.productName }]);
    },

    onWeeklyAllocation(products) {
      if (!up() || !products.length) return;
      // The API takes 10 products a call; a rebalance (once a week, twice in an agent run) is at most three calls, one after another.
      const batches = Math.min(3, Math.ceil(products.length / 10));
      for (let i = 0; i < batches; i++)
        rebalance(`Rebalance, simulation only (${i + 1} of ${batches}): ${products.slice(i * 10, i * 10 + 10).length} products`, products.slice(i * 10, i * 10 + 10));
    },

    setWaiting(on) {
      waiting = on;
    },

    busy: () => pending > 0,

    takeWeek() {
      const done = week;
      week = newWeek();
      return done;
    },

    dispose() {
      alive = false;
    },
  };
}
