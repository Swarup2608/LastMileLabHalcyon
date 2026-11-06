// A week in the life of Halcyon, simulated from the data in DATABASE_URL. Read-only: nothing is written.
//   npm run sim:week                      next Monday to Sunday, seed 1
//   npm run sim:week -- --start 2026-11-02 --seed 7 --runs 20 --out week.md
//   npm run sim:week -- --agent           also asks the real carrier agent (FOUNDRY_CARRIER_AGENT_NAME) about Monday
//   npm run sim:week -- --stock live      route against today's warehouse stock instead of history's outcomes
//
// Each day's orders are drawn from real deliveries on the same weekday (client, channel, commitment, destination region,
// address status, time of day), given products from that client's own catalogue and quantities, and routed against the
// live warehouse stock. The same orders then go through two processes:
//   before:  what the dataset shows happening. Same-day promised whenever it arrives, incomplete addresses shipped as
//            they are, carriers in the historical mix for the region.
//   halcyon: the app's rules. Same-day only before the admin's cutoff (later ones promised the next day), incomplete
//            addresses asked of the client, carriers ranked by the carrier agent's scoring rules.
// Whether an order arrives on time is drawn from the historical on-time rate of orders like it (commitment, before or
// after 08:00, address, shipped from the nearest warehouse or not), adjusted for the carrier's late rate into the
// region. Assumptions the data can't give are named in ASSUME.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { loadConfig } from "../config/env.js";
import { SettingsRepository } from "../repositories/settings.repository.js";
import { DEFAULT_DELIVERY_RULE, expectedDelivery, type DeliveryRule } from "../utils/delivery.js";
import { createFoundryAgent } from "../utils/foundry.js";
import { regionOf, type Region } from "../utils/regions.js";

const REGIONS: Region[] = ["Midwest", "Northeast", "Southeast", "West"];
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// What the data doesn't say, kept in one place and printed with the report.
const ASSUME = {
  // Share of clients who answer the address question, and how long they take (hours).
  addressAnswered: 0.8,
  answerHours: [0.5, 1, 1, 2, 2, 3, 4, 6],
  // Cartons per order line, and lines per order.
  cartons: [2, 4, 5, 6, 8, 10, 12, 12, 15, 20, 24, 30, 40],
  lines: [1, 1, 1, 1, 2, 2, 3],
  // Day-to-day volume noise around the weekday average.
  volumeNoise: 0.08,
  // Cost of a late delivery: the dataset's average redelivery cost for late orders.
  lateCostUsd: 34,
  // Best on-time chance any order gets.
  ceiling: 0.99,
  // What a carrier can take in a region in a day: its historical daily average there, plus this much headroom.
  capacityHeadroom: 1.3,
  // Afternoon wave (proposed): same-day orders in after the cutoff and before this minute of the day are picked at 14:00
  // and ride the 15:00–17:00 collections. Pick capacity isn't recorded (A7), so each warehouse takes at most waveSlots a day.
  waveLastMinute: 13 * 60,
  waveSlots: 15,
  // AI stock transfers (FR-07): share of nearest-warehouse stock-outs an approved overnight transfer prevents. The data
  // can't say (A8); F4's shortages come from the fixed allocation and are steady month to month, so they're foreseeable.
  transfersPrevent: 0.5,
};

// Somewhere real in each region, for the story.
const CITIES: Record<Region, [string, string][]> = {
  Midwest: [["Chicago", "IL"], ["Columbus", "OH"], ["Detroit", "MI"], ["Minneapolis", "MN"], ["St. Louis", "MO"], ["Milwaukee", "WI"]],
  Northeast: [["Boston", "MA"], ["New York", "NY"], ["Philadelphia", "PA"], ["Newark", "NJ"], ["Hartford", "CT"], ["Baltimore", "MD"]],
  Southeast: [["Atlanta", "GA"], ["Dallas", "TX"], ["Miami", "FL"], ["Charlotte", "NC"], ["Nashville", "TN"], ["New Orleans", "LA"]],
  West: [["Denver", "CO"], ["Phoenix", "AZ"], ["Seattle", "WA"], ["Portland", "OR"], ["San Francisco", "CA"], ["Salt Lake City", "UT"]],
};

// ---------- arguments ----------
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const seed = Number(arg("seed") ?? 1);
const runs = Math.max(1, Number(arg("runs") ?? 20));
const out = arg("out");
const askAgent = args.includes("--agent");
// history: each order's warehouse outcome is the real one of the delivery it was drawn from, so "before" matches the
//          dataset's 71% on time. live: route against today's warehouse_products, which holds each product in only some
//          warehouses, so far more orders ship from farther than history shows (a stress test, not a baseline).
const stockMode = arg("stock") === "live" ? "live" : "history";
const start = arg("start") ?? nextMonday(new Date());

function nextMonday(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + (((8 - x.getUTCDay()) % 7) || 7));
  return x.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------- seeded random ----------
function rng(s: number) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const pick = <T>(r: Rand, xs: T[]) => xs[Math.floor(r() * xs.length)];
const weighted = <T>(r: Rand, xs: [T, number][]) => {
  let x = r() * xs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of xs) if ((x -= w) <= 0) return v;
  return xs[xs.length - 1][0];
};

// ---------- data ----------
interface HistRow {
  client_id: string;
  order_channel: string;
  commitment_type: "same_day" | "next_day" | "standard";
  address_status: "complete" | "incomplete";
  destination_region: Region;
  dow: number;
  minute_of_day: number;
  // What happened at the warehouse: the nearest had no stock, or it had stock and the order still went farther.
  nearest_out: boolean;
  shipped_far: boolean;
}

async function load(db: Pool) {
  const q = async <T>(sql: string) => (await db.query(sql)).rows as T[];
  const [hist, segments, mix, carriers, warehouses, products, stock, rule] = await Promise.all([
    q<HistRow>(`SELECT client_id, order_channel, commitment_type, address_status, destination_region,
                  extract(isodow FROM order_received_ts)::int AS dow,
                  (extract(hour FROM order_received_ts) * 60 + extract(minute FROM order_received_ts))::int AS minute_of_day,
                  nearest_warehouse_had_stock = 'N' AS nearest_out,
                  (nearest_warehouse_had_stock = 'Y' AND fulfilment_warehouse_id <> nearest_warehouse_id) AS shipped_far
                FROM deliveries`),
    q<{ c: string; before8: boolean; a: string; off: boolean; n: string; ontime: string }>(
      `SELECT commitment_type c, order_received_ts::time < time '08:00' before8, address_status a,
              (nearest_warehouse_had_stock = 'N' OR fulfilment_warehouse_id <> nearest_warehouse_id) off,
              count(*) n, avg((on_time = 'Y')::int) ontime
       FROM deliveries GROUP BY 1, 2, 3, 4`,
    ),
    q<{ r: Region; carrier_id: string; n: string }>(`SELECT destination_region r, carrier_id, count(*) n FROM deliveries GROUP BY 1, 2`),
    q<{ carrier_id: string; preferred: boolean; midwest_late_pct: string; northeast_late_pct: string; southeast_late_pct: string; west_late_pct: string; avg_rate_usd: string }>(
      `SELECT carrier_id, preferred, midwest_late_pct, northeast_late_pct, southeast_late_pct, west_late_pct, avg_rate_usd
       FROM carrier_performance_latest ORDER BY carrier_id`,
    ),
    q<{ warehouse_id: string; warehouse_name: string; midwest: number; northeast: number; southeast: number; west: number }>(
      `SELECT w.warehouse_id, w.warehouse_name, d.midwest, d.northeast, d.southeast, d.west
       FROM warehouses w JOIN warehouse_region_distance d USING (warehouse_id) ORDER BY 1`,
    ),
    q<{ product_id: string; product_name: string; client_id: string }>(`SELECT product_id, product_name, client_id FROM products`),
    q<{ warehouse_id: string; product_id: string; available: number; reorder_point: number }>(
      `SELECT warehouse_id, product_id, (quantity_on_hand - quantity_reserved)::int available, reorder_point FROM warehouse_products`,
    ),
    new SettingsRepository(db).deliveryRule().catch(() => DEFAULT_DELIVERY_RULE),
  ]);

  const seg = new Map(segments.map((s) => [`${s.c}|${s.before8}|${s.a}|${s.off}`, { rate: Number(s.ontime), n: Number(s.n) }]));
  const late: Record<string, Record<Region, number>> = {};
  const price: Record<string, number> = {};
  const preferred: Record<string, boolean> = {};
  for (const c of carriers) {
    late[c.carrier_id] = {
      Midwest: Number(c.midwest_late_pct),
      Northeast: Number(c.northeast_late_pct),
      Southeast: Number(c.southeast_late_pct),
      West: Number(c.west_late_pct),
    };
    price[c.carrier_id] = Number(c.avg_rate_usd);
    preferred[c.carrier_id] = c.preferred;
  }
  // The historical carrier mix per region, and the on-time rate it averaged: a carrier's factor is how much better or
  // worse than that average it is in the region.
  const histMix: Record<Region, [string, number][]> = { Midwest: [], Northeast: [], Southeast: [], West: [] };
  for (const m of mix) if (m.carrier_id && histMix[m.r]) histMix[m.r].push([m.carrier_id, Number(m.n)]);
  const mixOnTime = Object.fromEntries(
    REGIONS.map((r) => {
      const total = histMix[r].reduce((s, [, n]) => s + n, 0);
      return [r, histMix[r].reduce((s, [c, n]) => s + (n / total) * (1 - late[c][r] / 100), 0)];
    }),
  ) as Record<Region, number>;

  const catalogue = new Map<string, { id: string; name: string }[]>();
  for (const p of products) {
    if (!catalogue.has(p.client_id)) catalogue.set(p.client_id, []);
    catalogue.get(p.client_id)!.push({ id: p.product_id, name: p.product_name });
  }
  const miles = (w: (typeof warehouses)[number], r: Region) => w[r.toLowerCase() as "midwest"];
  const byDistance = Object.fromEntries(REGIONS.map((r) => [r, [...warehouses].sort((a, b) => miles(a, r) - miles(b, r))])) as Record<
    Region,
    typeof warehouses
  >;
  const byDow = new Map<number, HistRow[]>();
  for (const h of hist) {
    if (!byDow.has(h.dow)) byDow.set(h.dow, []);
    byDow.get(h.dow)!.push(h);
  }
  const days = await q<{ dow: number; per_day: string }>(
    `SELECT extract(isodow FROM order_received_ts)::int dow, count(*)::numeric / count(DISTINCT order_received_ts::date) per_day
     FROM deliveries GROUP BY 1`,
  );
  const perDay = new Map(days.map((d) => [d.dow, Number(d.per_day)]));
  const histOnTime = (await q<{ r: string }>(`SELECT avg((on_time = 'Y')::int) r FROM deliveries`))[0].r;
  const histDays = Number((await q<{ n: string }>(`SELECT count(DISTINCT order_received_ts::date) n FROM deliveries`))[0].n);
  // Historical on-time and share for orders shipped from the nearest warehouse, to calibrate against.
  const near = (await q<{ r: string; off: string }>(
    `SELECT avg((on_time = 'Y')::int) FILTER (WHERE NOT (nearest_warehouse_had_stock = 'N' OR fulfilment_warehouse_id <> nearest_warehouse_id)) r,
            avg((nearest_warehouse_had_stock = 'N' OR fulfilment_warehouse_id <> nearest_warehouse_id)::int) off
     FROM deliveries`,
  ))[0];
  const capacity = Object.fromEntries(
    REGIONS.map((r) => [r, Object.fromEntries(histMix[r].map(([c, n]) => [c, Math.ceil((n / histDays) * ASSUME.capacityHeadroom)]))]),
  ) as Record<Region, Record<string, number>>;
  // A wave order is collected late in the day: how same-day orders picked that morning did when collected at 15:00 or
  // later, against all of them (clean orders from the nearest warehouse), and how many collections run that late.
  const lateShip = (await q<{ late: string; all: string; share: string }>(
    `SELECT avg((on_time = 'Y')::int) FILTER (WHERE shipped_ts::date = order_received_ts::date AND shipped_ts::time >= time '15:00') late,
            avg((on_time = 'Y')::int) "all",
            (SELECT avg((shipped_ts::time >= time '15:00')::int) FROM deliveries WHERE shipped_ts IS NOT NULL) share
     FROM deliveries
     WHERE commitment_type = 'same_day' AND order_received_ts::time < time '08:00' AND address_status = 'complete'
       AND nearest_warehouse_had_stock = 'Y' AND fulfilment_warehouse_id = nearest_warehouse_id`,
  ))[0];
  const waveFactor = Number(lateShip.late) / Number(lateShip.all);

  return { byDow, perDay, seg, late, price, preferred, histMix, mixOnTime, catalogue, byDistance, stock, rule, warehouses, histOnTime: Number(histOnTime), nearOnTime: Number(near.r), histOffNearest: Number(near.off), capacity, waveFactor, lateShipOnTime: Number(lateShip.late), lateShipShare: Number(lateShip.share) };
}
type Data = Awaited<ReturnType<typeof load>>;

// ---------- the carrier agent's scoring rules ----------
// Same-day and next-day weigh reliability 80% and price 20%; standard 60/40. Price score = cheapest ÷ price × 100.
function rankCarriers(d: Data, region: Region, commitment: string) {
  const w = commitment === "standard" ? 0.6 : 0.8;
  const cheapest = Math.min(...Object.values(d.price));
  return Object.keys(d.price)
    .map((c) => {
      const onTime = 100 - d.late[c][region];
      const score = w * onTime + (1 - w) * ((cheapest / d.price[c]) * 100);
      return { carrier: c, onTime, price: d.price[c], score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------- one simulated week ----------
interface Order {
  id: string;
  day: string;
  dow: number;
  at: Date;
  client: string;
  channel: string;
  commitment: "same_day" | "next_day" | "standard";
  region: Region;
  city: string;
  state: string;
  addressComplete: boolean;
  nearestOut: boolean;
  shippedFar: boolean;
  lines: { product: string; name: string; cartons: number }[];
}

interface Outcome {
  warehouse: string | null;
  offNearest: boolean;
  carrier: string;
  promise: string;
  sameDayPromised: boolean;
  // Picked on the afternoon wave instead of moving to the next day.
  wave: boolean;
  // The nearest warehouse was short, and an approved transfer had restocked it.
  transferred: boolean;
  addressAsked: boolean;
  addressFixed: boolean;
  onTime: boolean;
  shipCost: number;
}

const local = (date: string, minuteOfDay: number, rule: DeliveryRule) => {
  // The order's time in the cutoff's zone, as a real instant: take the UTC guess and correct by the zone's offset.
  const guess = new Date(`${date}T${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: rule.timeZone }));
  const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (asUtc.getTime() - shown.getTime()));
};

function makeOrders(d: Data, r: Rand) {
  const orders: Order[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const dow = i + 1;
    const pool = d.byDow.get(dow) ?? [];
    const n = Math.round((d.perDay.get(dow) ?? 0) * (1 + (r() * 2 - 1) * ASSUME.volumeNoise));
    for (let k = 0; k < n; k++) {
      const h = pick(r, pool);
      const own = d.catalogue.get(h.client_id);
      const products = own?.length ? own : [...d.catalogue.values()].flat();
      const [city, state] = pick(r, CITIES[h.destination_region]);
      const lines = Array.from({ length: pick(r, ASSUME.lines) }, () => {
        const p = pick(r, products);
        return { product: p.id, name: p.name, cartons: pick(r, ASSUME.cartons) };
      });
      orders.push({
        id: `SIM-${day.slice(5).replace("-", "")}-${String(k + 1).padStart(3, "0")}`,
        day,
        dow,
        at: local(day, h.minute_of_day, d.rule),
        client: h.client_id,
        channel: h.order_channel,
        commitment: h.commitment_type,
        region: h.destination_region,
        city,
        state,
        addressComplete: h.address_status === "complete",
        nearestOut: h.nearest_out,
        shippedFar: h.shipped_far,
        lines,
      });
    }
  }
  return orders.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// Each product from the nearest warehouse that has enough of it, taking the stock (an order can split across warehouses,
// as staff route it on Resolve). warehouses: null when some product is out everywhere, and then nothing is taken.
// offNearest: some product ships from farther than the nearest warehouse.
function route(d: Data, stock: Map<string, number>, o: Order) {
  const ranked = d.byDistance[o.region];
  const want = new Map<string, number>();
  for (const l of o.lines) want.set(l.product, (want.get(l.product) ?? 0) + l.cartons);
  const plan: [string, string, number][] = [];
  let offNearest = false;
  for (const [product, cartons] of want) {
    const at = ranked.findIndex((w) => (stock.get(`${w.warehouse_id}|${product}`) ?? 0) >= cartons);
    if (at === -1) return { warehouses: null, offNearest: true };
    if (at > 0) offNearest = true;
    plan.push([ranked[at].warehouse_id, product, cartons]);
  }
  for (const [w, product, cartons] of plan) stock.set(`${w}|${product}`, stock.get(`${w}|${product}`)! - cartons);
  return { warehouses: [...new Set(plan.map(([w]) => w))], offNearest };
}

function onTimeChance(d: Data, commitment: string, before8: boolean, complete: boolean, off: boolean, carrier: string, region: Region) {
  const base = d.seg.get(`${commitment}|${before8}|${complete ? "complete" : "incomplete"}|${off}`)?.rate ?? 0.5;
  const factor = (1 - d.late[carrier][region] / 100) / d.mixOnTime[region];
  return Math.min(ASSUME.ceiling, base * factor);
}

// Halcyon's rules, each of which can be left out to see what it alone is worth. The first four are the built rules the
// headline used to rest on; the AI transfers and the afternoon wave come on top.
type Lever = "cutoff" | "address" | "routing" | "carrier" | "transfers" | "wave";
const LEVERS: [Lever, string][] = [
  ["cutoff", "Same-day cutoff (FR-01)"],
  ["address", "Address questions (FR-04)"],
  ["routing", "Nearest warehouse with stock (FR-05)"],
  ["carrier", "Carrier ranking per region (FR-06)"],
  ["transfers", "AI stock transfers (FR-07)"],
  ["wave", "Afternoon wave (proposed)"],
];
const CORE: Lever[] = ["cutoff", "address", "routing", "carrier"];

function simulate(d: Data, s: number, levers: Set<Lever> = new Set(LEVERS.map(([l]) => l))) {
  const r = rng(s);
  // Its own stream, so the transfers draw doesn't shift the draws the four built rules see.
  const rt = rng(s ^ 0x9e3779b9);
  const [ch, cm] = d.rule.sameDayCutoff.split(":").map(Number);
  const cutoffMinute = ch * 60 + cm;
  const waveUsed = new Map<string, number>();
  const orders = makeOrders(d, r);
  const stockStart = new Map(d.stock.map((x) => [`${x.warehouse_id}|${x.product_id}`, Math.max(0, x.available)]));
  const stock = new Map(stockStart);
  // Bookings per day, carrier and region, against its capacity.
  const booked = new Map<string, number>();
  const book = (day: string, region: Region, ranked: string[]) => {
    const c = ranked.find((x) => (booked.get(`${day}|${region}|${x}`) ?? 0) < (d.capacity[region][x] ?? 0)) ?? ranked[0];
    booked.set(`${day}|${region}|${c}`, (booked.get(`${day}|${region}|${c}`) ?? 0) + 1);
    return c;
  };
  const before: Outcome[] = [];
  const halcyon: Outcome[] = [];
  const stockOuts: Order[] = [];
  const minuteIn = (at: Date) => {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: d.rule.timeZone }).format(at).split(":");
    return Number(h) * 60 + Number(m);
  };

  for (const o of orders) {
    // history: the nearest warehouse, or the next one when the real order went farther. Halcyon routes to the nearest
    // warehouse with stock, so it only goes farther when the nearest really had none.
    const ranked = d.byDistance[o.region];
    const routed =
      stockMode === "live"
        ? route(d, stock, o)
        : { warehouses: [ranked[o.nearestOut || o.shippedFar ? 1 : 0].warehouse_id], offNearest: o.nearestOut || o.shippedFar };
    const warehouse = routed.warehouses?.join("+") ?? null;
    if (!warehouse) stockOuts.push(o);
    const off = routed.offNearest;
    // An approved overnight transfer can restock the nearest warehouse before the order lands.
    const transferred = stockMode === "history" && o.nearestOut && rt() < ASSUME.transfersPrevent && levers.has("transfers");
    const short = o.nearestOut && !transferred;
    const hWarehouse = stockMode === "live" ? warehouse : levers.has("routing") ? ranked[short ? 1 : 0].warehouse_id : transferred && !o.shippedFar ? ranked[0].warehouse_id : warehouse;
    const hOff = stockMode === "live" ? off : levers.has("routing") ? short : transferred ? o.shippedFar : off;
    const before8 = minuteIn(o.at) < 8 * 60;
    // One draw per order, used by both processes, so the comparison is the process and not the luck.
    const luck = r();

    // Before: same-day whenever it came in, address as it came, carrier in the historical mix.
    const bCarrier = weighted(r, d.histMix[o.region]);
    const bChance = warehouse ? onTimeChance(d, o.commitment, before8, o.addressComplete, off, bCarrier, o.region) : 0;
    before.push({
      warehouse,
      offNearest: off,
      carrier: bCarrier,
      promise: o.commitment === "same_day" ? o.day : o.day,
      sameDayPromised: o.commitment === "same_day",
      wave: false,
      transferred: false,
      addressAsked: false,
      addressFixed: false,
      onTime: luck < bChance,
      shipCost: d.price[bCarrier],
    });

    // Halcyon: ask for a missing address; the order's intake is when it's complete; same-day only before the cutoff.
    // A rule left out of `levers` behaves as before (the draws are still taken, so the other orders don't change).
    let complete = o.addressComplete;
    let intake = o.at;
    const asked = !complete && levers.has("address");
    if (!complete && r() < ASSUME.addressAnswered) {
      const wait = pick(r, ASSUME.answerHours);
      if (asked) {
        complete = true;
        intake = new Date(o.at.getTime() + wait * 3600_000);
      }
    }
    const due = expectedDelivery(intake, d.rule);
    // Afternoon wave: a same-day order that missed the cutoff but is complete before 13:00 the same day is picked at
    // 14:00, while its warehouse has wave slots left today.
    const intakeMinute = minuteIn(intake);
    const sameDate = intake.toLocaleDateString("en-CA", { timeZone: d.rule.timeZone }) === o.day;
    const waveKey = `${o.day}|${hWarehouse}`;
    const wave =
      levers.has("wave") && levers.has("cutoff") && o.commitment === "same_day" && !due.sameDay && !!hWarehouse && sameDate &&
      intakeMinute >= cutoffMinute && intakeMinute < ASSUME.waveLastMinute && (waveUsed.get(waveKey) ?? 0) < ASSUME.waveSlots;
    if (wave) waveUsed.set(waveKey, (waveUsed.get(waveKey) ?? 0) + 1);
    const sameDay = o.commitment === "same_day" && (due.sameDay || wave || !levers.has("cutoff"));
    // The top-scoring carrier with room left today, else the next.
    const hCarrier = levers.has("carrier") ? book(o.day, o.region, rankCarriers(d, o.region, o.commitment).map((x) => x.carrier)) : bCarrier;
    // Same-day after the cutoff becomes a next-day promise: judged like the dataset's next-day orders.
    const commitment = o.commitment === "same_day" && !sameDay ? "next_day" : o.commitment;
    const intakeBefore8 = intakeMinute < 8 * 60;
    // A wave order is picked the same day like a morning one, then collected late: history's late-collection rate.
    const hChance = !hWarehouse
      ? 0
      : wave
        ? Math.min(ASSUME.ceiling, onTimeChance(d, "same_day", true, complete, hOff, hCarrier, o.region) * d.waveFactor)
        : onTimeChance(d, commitment, commitment === "next_day" && o.commitment === "same_day" ? false : intakeBefore8, complete, hOff, hCarrier, o.region);
    halcyon.push({
      warehouse: hWarehouse,
      offNearest: hOff,
      carrier: hCarrier,
      promise: wave ? o.day : due.date,
      sameDayPromised: sameDay,
      wave,
      transferred,
      addressAsked: asked,
      addressFixed: asked && complete,
      onTime: luck < hChance,
      shipCost: d.price[hCarrier],
    });
  }
  return { orders, before, halcyon, stockOuts, stockStart, stock };
}

// ---------- measures ----------
const pct = (n: number, of: number) => (of ? (100 * n) / of : 0);
const f1 = (x: number) => `${x.toFixed(1)}%`;
const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

function kpis(w: ReturnType<typeof simulate>, which: "before" | "halcyon", filter: (o: Order) => boolean = () => true) {
  const idx = w.orders.map((o, i) => (filter(o) ? i : -1)).filter((i) => i >= 0);
  const outs = idx.map((i) => w[which][i]);
  const sameDay = idx.filter((i) => w.orders[i].commitment === "same_day");
  const late = outs.filter((x) => !x.onTime).length;
  return {
    orders: outs.length,
    onTime: pct(outs.filter((x) => x.onTime).length, outs.length),
    // Same-day orders delivered on the day they were placed, out of all same-day orders.
    sameDayDelivered: pct(sameDay.filter((i) => w[which][i].sameDayPromised && w[which][i].onTime).length, sameDay.length),
    // Promises kept for same-day orders, whatever the promise became.
    sameDayKept: pct(sameDay.filter((i) => w[which][i].onTime).length, sameDay.length),
    late,
    lateCost: late * ASSUME.lateCostUsd,
    shipCost: outs.reduce((s, x) => s + x.shipCost, 0),
    asked: outs.filter((x) => x.addressAsked).length,
    fixed: outs.filter((x) => x.addressFixed).length,
    // As shares, for comparing days and runs.
    latePct: pct(late, outs.length),
    sameDayShare: pct(sameDay.length, idx.length),
    afterCutoff: pct(sameDay.filter((i) => !w[which][i].sameDayPromised).length, sameDay.length),
    wavePct: pct(sameDay.filter((i) => w[which][i].wave).length, sameDay.length),
    waveCount: outs.filter((x) => x.wave).length,
    transferred: outs.filter((x) => x.transferred).length,
    askedPct: pct(outs.filter((x) => x.addressAsked).length, outs.length),
    answeredPct: pct(outs.filter((x) => x.addressFixed).length, outs.filter((x) => x.addressAsked).length),
    nearestPct: pct(outs.filter((x) => x.warehouse && !x.offNearest).length, outs.length),
    fartherPct: pct(outs.filter((x) => x.warehouse && x.offNearest).length, outs.length),
    stockOutPct: pct(outs.filter((x) => !x.warehouse).length, outs.length),
    costPerOrder: outs.length ? outs.reduce((s, x) => s + x.shipCost, 0) / outs.length : 0,
  };
}
type Kpis = ReturnType<typeof kpis>;

// ---------- report ----------
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = new Pool({ connectionString: url });
  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  try {
    const d = await load(db);
    const w = simulate(d, seed);
    const name = (ids: string | null) =>
      ids ? ids.split("+").map((id) => d.warehouses.find((x) => x.warehouse_id === id)?.warehouse_name ?? id).join(" + ") : "no stock";

    say(`# Halcyon — simulated week ${start} to ${addDays(start, 6)}`);
    say();
    say(`Seed ${seed}. Same-day cutoff ${d.rule.sameDayCutoff} (${d.rule.timeZone}). ${w.orders.length.toLocaleString("en-US")} orders drawn from ${[...d.byDow.values()].reduce((s, x) => s + x.length, 0).toLocaleString("en-US")} real deliveries; products from the live catalogue. ${stockMode === "live" ? `Routed against live stock (${d.stock.length.toLocaleString("en-US")} warehouse stock rows), a stress test: it ships far more from farther warehouses than history.` : "Each order's warehouse outcome (nearest out of stock, or shipped farther anyway) is the real one of the delivery it was drawn from."}`);
    say();

    // The day-by-day story.
    say("## The week, day by day");
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const today = (o: Order) => o.day === day;
      const todays = w.orders.filter(today);
      const b = kpis(w, "before", today);
      const h = kpis(w, "halcyon", today);
      const sd = todays.filter((o) => o.commitment === "same_day");
      const sdLate = sd.filter((o) => !expectedDelivery(o.at, d.rule).sameDay).length;
      const ch = (c: string) => todays.filter((o) => o.channel === c).length;
      const idx = w.orders.map((o, k) => (today(o) ? k : -1)).filter((k) => k >= 0);
      const outs = idx.filter((k) => !w.halcyon[k].warehouse).length;
      const offNearest = idx.filter((k) => w.halcyon[k].warehouse && w.halcyon[k].offNearest).length;
      say();
      say(`### ${DAY_NAMES[i + 1]} ${day}`);
      say(`- ${todays.length} orders: ${ch("Email")} by email, ${ch("API")} API, ${ch("EDI")} EDI. ${sd.length} want same-day; ${sdLate} of those came in after ${d.rule.sameDayCutoff}: ${h.waveCount} still went out on the 14:00 afternoon wave, the rest were promised the next day.`);
      say(`- The email agent flagged ${h.asked} incomplete addresses; clients answered ${h.fixed} of them.`);
      if (stockMode === "history") say(`- Stock: ${h.transferred} orders found their nearest warehouse restocked by an approved AI transfer.`);
      say(`- Routing: ${idx.length - outs - offNearest} shipped from the nearest warehouse, ${offNearest} had something sent from a farther one with stock, ${outs} had a product out of stock everywhere (out-of-stock flag, new date offered).`);
      // The carrier plan at the cutoff: the agent's top pick for each region today's same-day orders go to.
      const regions = [...new Set(sd.map((o) => o.region))].sort();
      const picks = regions.map((r) => {
        const [top, next] = rankCarriers(d, r, "same_day");
        return `${r} → ${top.carrier} (${top.score}, ${top.onTime.toFixed(0)}% on time${d.preferred[top.carrier] ? ", preferred" : ""}; next ${next.carrier} ${next.score})`;
      });
      if (picks.length) say(`- Carrier plan at ${d.rule.sameDayCutoff}: ${picks.join("; ")}.`);
      say(`- On time: before ${f1(b.onTime)}, Halcyon ${f1(h.onTime)}. Same-day orders delivered that day: before ${f1(b.sameDayDelivered)}, Halcyon ${f1(h.sameDayDelivered)} (promises kept: before ${f1(b.sameDayKept)}, Halcyon ${f1(h.sameDayKept)}).`);
      say(`- As shares of the day: ${f1(h.sameDayShare)} same-day (${f1(h.afterCutoff)} of them after the cutoff), ${f1(h.askedPct)} with an incomplete address (${f1(h.answeredPct)} answered), ${f1(h.nearestPct)} from the nearest warehouse, ${f1(h.fartherPct)} from farther, ${f1(h.stockOutPct)} out of stock; ${f1(b.latePct)} late before, ${f1(h.latePct)} with Halcyon.`);
      const promised = idx.map((k) => [w.orders[k], w.halcyon[k]] as const).filter(([o, x]) => o.commitment === "same_day" && x.sameDayPromised);
      const ex = promised[Math.floor(promised.length / 2)];
      if (ex) {
        const [o, x] = ex;
        say(`- e.g. ${o.id}: ${o.client} (${o.channel}), ${o.lines.map((l) => `${l.name} ×${l.cartons}`).join(", ")} to ${o.city}, ${o.state}, in at ${o.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: d.rule.timeZone })} → ${name(x.warehouse)}, carrier ${x.carrier}, ${x.onTime ? "delivered on time" : "arrived late"}.`);
      }
    }

    // The week.
    const B = kpis(w, "before");
    const H = kpis(w, "halcyon");
    say();
    say("## The week in numbers");
    say();
    say("| Measure | Before | Halcyon | Change |");
    say("|---|---:|---:|---:|");
    const row = (label: string, b: number, h: number, fmt: (x: number) => string, unit = "") =>
      say(`| ${label} | ${fmt(b)} | ${fmt(h)} | ${h - b >= 0 ? "+" : ""}${unit === "pts" ? (h - b).toFixed(1) + " pts" : fmt(h - b)} |`);
    row("On time (against the promise)", B.onTime, H.onTime, f1, "pts");
    row("Same-day orders delivered that day", B.sameDayDelivered, H.sameDayDelivered, f1, "pts");
    row("Same-day promises kept", B.sameDayKept, H.sameDayKept, f1, "pts");
    row("Late deliveries", B.late, H.late, (x) => Math.round(x).toLocaleString("en-US"));
    row("Redelivery cost of late orders", B.lateCost, H.lateCost, usd);
    row("Carrier spend (average rates)", B.shipCost, H.shipCost, usd);
    say(`| Address questions sent / answered | – | ${H.asked} / ${H.fixed} | |`);
    say();
    const lateSameDay = f1((d.seg.get("same_day|false|complete|false")?.rate ?? 0) * 100);
    if (H.waveCount)
      say(`Before, same-day orders that came in after ${d.rule.sameDayCutoff} were promised same-day anyway and made it ${lateSameDay} of the time. Now those complete by ${String(ASSUME.waveLastMinute / 60).padStart(2, "0")}:00 go out on the 14:00 afternoon wave (${H.waveCount} this week) and the rest are promised the next day, so more same-day orders arrive that day and far fewer promises break.`);
    else
      say(`Same-day delivered that day falls because Halcyon stops promising same-day after ${d.rule.sameDayCutoff}: before, those late arrivals were promised same-day anyway and made it ${lateSameDay} of the time; now they're promised the next day and kept far more often. Fewer same-day deliveries, far fewer broken same-day promises.`);

    // Every rate for the whole week: per day side by side with the week's total, then broken down.
    say();
    say("## Percentages for the whole week");
    say();
    say("| Day | Orders | Same-day | After cutoff | Address flagged | Answered | Nearest WH | Farther WH | Out of stock | On time before | On time Halcyon | Same-day kept before | Same-day kept Halcyon |");
    say("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    const dayRow = (label: string, b: Kpis, h: Kpis) =>
      say(
        `| ${label} | ${h.orders.toLocaleString("en-US")} | ${f1(h.sameDayShare)} | ${f1(h.afterCutoff)} | ${f1(h.askedPct)} | ${f1(h.answeredPct)} | ${f1(h.nearestPct)} | ${f1(h.fartherPct)} | ${f1(h.stockOutPct)} | ${f1(b.onTime)} | ${f1(h.onTime)} | ${f1(b.sameDayKept)} | ${f1(h.sameDayKept)} |`,
      );
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const today = (o: Order) => o.day === day;
      dayRow(`${DAY_NAMES[i + 1]} ${day.slice(5)}`, kpis(w, "before", today), kpis(w, "halcyon", today));
    }
    dayRow("**Week**", B, H);

    const breakdown = (title: string, groups: [string, (o: Order) => boolean][]) => {
      say();
      say(`| ${title} | Orders | Share | On time before | On time Halcyon | Change | Late before | Late Halcyon |`);
      say("|---|---:|---:|---:|---:|---:|---:|---:|");
      for (const [label, f] of groups) {
        const b = kpis(w, "before", f);
        const h = kpis(w, "halcyon", f);
        if (!h.orders) continue;
        say(`| ${label} | ${h.orders.toLocaleString("en-US")} | ${f1(pct(h.orders, w.orders.length))} | ${f1(b.onTime)} | ${f1(h.onTime)} | ${h.onTime - b.onTime >= 0 ? "+" : ""}${(h.onTime - b.onTime).toFixed(1)} pts | ${f1(b.latePct)} | ${f1(h.latePct)} |`);
      }
    };
    const cutoffMinutes = (() => {
      const [hh, mm] = d.rule.sameDayCutoff.split(":").map(Number);
      return hh * 60 + mm;
    })();
    const minuteOf = (o: Order) => {
      const [hh, mm] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: d.rule.timeZone }).format(o.at).split(":");
      return Number(hh) * 60 + Number(mm);
    };
    breakdown("Commitment", [
      ["Same-day", (o) => o.commitment === "same_day"],
      ["Next-day", (o) => o.commitment === "next_day"],
      ["Standard", (o) => o.commitment === "standard"],
    ]);
    breakdown("Channel", [
      ["Email", (o) => o.channel === "Email"],
      ["API", (o) => o.channel === "API"],
      ["EDI", (o) => o.channel === "EDI"],
    ]);
    breakdown("Region", REGIONS.map((r) => [r, (o: Order) => o.region === r] as [string, (o: Order) => boolean]));
    breakdown("Arrived", [
      [`Before ${d.rule.sameDayCutoff}`, (o) => minuteOf(o) < cutoffMinutes],
      [`After ${d.rule.sameDayCutoff}`, (o) => minuteOf(o) >= cutoffMinutes],
    ]);
    breakdown("Address", [
      ["Complete", (o) => o.addressComplete],
      ["Incomplete", (o) => !o.addressComplete],
    ]);

    const mixOf = (which: "before" | "halcyon") => {
      const counts = new Map<string, number>();
      for (const x of w[which]) counts.set(x.carrier, (counts.get(x.carrier) ?? 0) + 1);
      return [...counts].sort().map(([c, n]) => `${c} ${f1(pct(n, w[which].length))}`).join(", ");
    };
    say();
    say(`Carrier mix before: ${mixOf("before")}.`);
    say(`Carrier mix with Halcyon: ${mixOf("halcyon")}.`);
    const offShare = (which: "before" | "halcyon") => f1(pct(w[which].filter((x) => x.warehouse && x.offNearest).length, w.orders.length));
    if (stockMode === "live") {
      const low = d.stock.filter((x) => (w.stock.get(`${x.warehouse_id}|${x.product_id}`) ?? 0) < x.reorder_point && (w.stockStart.get(`${x.warehouse_id}|${x.product_id}`) ?? 0) >= x.reorder_point);
      say(`Routing: ${offShare("halcyon")} of orders had something shipped from beyond the nearest warehouse, against ${f1(d.histOffNearest * 100)} in the dataset: the live stock holds each product in only some warehouses.`);
      say(`Stock: ${w.stockOuts.length} orders had a product out of stock everywhere; ${low.length} warehouse/product pairs fell below their reorder point this week.`);
    } else {
      say(`Routing: before, ${offShare("before")} of orders shipped from beyond the nearest warehouse (dataset ${f1(d.histOffNearest * 100)}). With Halcyon, ${offShare("halcyon")}: only those whose nearest warehouse really had no stock. The rest had stock nearby and went far because no rule stopped it.`);
    }

    // The same week with other draws: every rate's average and range, so luck can be told from the process.
    if (runs > 1) {
      const all = Array.from({ length: runs }, (_, k) => {
        const x = simulate(d, seed + k);
        return { b: kpis(x, "before"), h: kpis(x, "halcyon") };
      });
      const band = (get: (r: (typeof all)[number]) => number, unit = "%") => {
        const xs = all.map(get).sort((a, b) => a - b);
        const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
        const fmt = (x: number) => (unit === "pts" ? `${x >= 0 ? "+" : ""}${x.toFixed(1)}` : x.toFixed(1));
        return `${fmt(mean)}${unit === "pts" ? " pts" : "%"} (${fmt(xs[0])} to ${fmt(xs[xs.length - 1])})`;
      };
      say();
      say(`## Over ${runs} simulated weeks (seeds ${seed}–${seed + runs - 1})`);
      say();
      say("Average, with the lowest and highest week.");
      say();
      say("| Rate | Before | Halcyon | Change |");
      say("|---|---:|---:|---:|");
      const bandRow = (label: string, get: (k: Kpis) => number, both = true) =>
        say(`| ${label} | ${both ? band((r) => get(r.b)) : "–"} | ${band((r) => get(r.h))} | ${both ? band((r) => get(r.h) - get(r.b), "pts") : ""} |`);
      bandRow("On time (against the promise)", (k) => k.onTime);
      bandRow("Late", (k) => k.latePct);
      bandRow("Same-day delivered that day", (k) => k.sameDayDelivered);
      bandRow("Same-day promises kept", (k) => k.sameDayKept);
      bandRow("Same-day share of orders", (k) => k.sameDayShare, false);
      bandRow("Same-day orders after the cutoff (moved to next day)", (k) => k.afterCutoff, false);
      bandRow("Same-day orders saved by the afternoon wave", (k) => k.wavePct, false);
      bandRow("Orders with an incomplete address", (k) => k.askedPct, false);
      bandRow("Address questions answered", (k) => k.answeredPct, false);
      bandRow("Shipped from the nearest warehouse", (k) => k.nearestPct, false);
      bandRow("Shipped partly from farther", (k) => k.fartherPct, false);
      bandRow("Out of stock everywhere", (k) => k.stockOutPct, false);
      say(`| Carrier cost per order | $${(all.reduce((sum, r) => sum + r.b.costPerOrder, 0) / runs).toFixed(2)} | $${(all.reduce((sum, r) => sum + r.h.costPerOrder, 0) / runs).toFixed(2)} | |`);

      // Where the gain comes from: each rule on its own, and everything but that rule, over the same weeks.
      const gain = (levers: Set<Lever>) => {
        const xs = Array.from({ length: runs }, (_, k) => {
          const x = simulate(d, seed + k, levers);
          return kpis(x, "halcyon").onTime - kpis(x, "before").onTime;
        });
        return xs.reduce((sum, x) => sum + x, 0) / xs.length;
      };
      const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} pts`;
      const total = all.reduce((sum, r) => sum + r.h.onTime - r.b.onTime, 0) / runs;
      say();
      say("### Where the on-time gain comes from");
      say();
      const core = gain(new Set(CORE));
      say(`All ${LEVERS.length} rules together: ${signed(total)}. The four built rules alone (FR-01, FR-04, FR-05, FR-06): ${signed(core)}; the AI transfers and the afternoon wave add ${signed(total - core)} on top. The rules overlap (an order can be late for two reasons), so the parts don't add up exactly.`);
      say();
      say("| Rule | This rule alone | All rules except this one | Lost without it |");
      say("|---|---:|---:|---:|");
      for (const [lever, label] of LEVERS) {
        const alone = gain(new Set([lever]));
        const without = gain(new Set(LEVERS.map(([l]) => l).filter((l) => l !== lever)));
        say(`| ${label} | ${signed(alone)} | ${signed(without)} | ${signed(without - total)} |`);
      }
    }

    // Checks: the app's rules held, and the model matches the data it came from.
    say();
    say("## Checks");
    const checks: [string, boolean, string][] = [];
    const sdBreaks = w.orders.filter((o, k) => w.halcyon[k].sameDayPromised && !w.halcyon[k].wave && !expectedDelivery(o.at, d.rule).sameDay && !w.halcyon[k].addressAsked);
    checks.push(["Same-day is only promised before the cutoff, or on the afternoon wave", sdBreaks.length === 0, `${sdBreaks.length} same-day promises made after ${d.rule.sameDayCutoff} outside the wave`]);
    const waveLoad = new Map<string, number>();
    w.halcyon.forEach((x, k) => x.wave && waveLoad.set(`${w.orders[k].day}|${x.warehouse}`, (waveLoad.get(`${w.orders[k].day}|${x.warehouse}`) ?? 0) + 1));
    const overWave = [...waveLoad.values()].filter((n) => n > ASSUME.waveSlots).length;
    checks.push(["No warehouse picks more afternoon-wave orders than its slots", overWave === 0, `${overWave} warehouse-days over ${ASSUME.waveSlots}`]);
    const negative = [...w.stock.values()].filter((v) => v < 0).length;
    checks.push(["Stock never goes negative", negative === 0, `${negative} negative stock rows`]);
    const routedWithout = w.orders.filter((o, k) => w.halcyon[k].warehouse === null && w.halcyon[k].onTime).length;
    checks.push(["An order with no stock is never counted delivered", routedWithout === 0, `${routedWithout} delivered without stock`]);
    const unmapped = w.orders.filter((o) => regionOf(o.state, "") !== o.region).length;
    checks.push(["Every destination maps to its region (as the carrier plan reads it)", unmapped === 0, `${unmapped} addresses map to the wrong region`]);
    // A carrier below the top is only booked once every better one was full that day in that region.
    const used = new Map<string, number>();
    w.orders.forEach((o, k) => used.set(`${o.day}|${o.region}|${w.halcyon[k].carrier}`, (used.get(`${o.day}|${o.region}|${w.halcyon[k].carrier}`) ?? 0) + 1));
    const skipped = w.orders.filter((o, k) => {
      const ranked = rankCarriers(d, o.region, o.commitment).map((x) => x.carrier);
      return ranked
        .slice(0, ranked.indexOf(w.halcyon[k].carrier))
        .some((c) => (used.get(`${o.day}|${o.region}|${c}`) ?? 0) < (d.capacity[o.region][c] ?? 0));
    }).length;
    checks.push(["A lower-scoring carrier is only booked when every better one is full", skipped === 0, `${skipped} orders skipped a carrier with room`]);
    const over = [...new Set(w.orders.map((o) => `${o.day}|${o.region}`))].flatMap((key) => {
      const [day, region] = key.split("|") as [string, Region];
      const idx = w.orders.map((o, k) => (o.day === day && o.region === region ? k : -1)).filter((k) => k >= 0);
      return Object.keys(d.price).filter((c) => idx.filter((k) => w.halcyon[k].carrier === c).length > Math.max(d.capacity[region][c] ?? 0, 0) && idx.length <= Object.values(d.capacity[region]).reduce((a, b) => a + b, 0));
    }).length;
    checks.push(["No carrier is booked past its daily capacity in a region", over === 0, `${over} carrier-days over capacity`]);
    const midwestF = rankCarriers(d, "Midwest", "same_day").find((x) => x.carrier === "F");
    const expectF = 0.8 * (100 - d.late.F.Midwest) + 0.2 * 100;
    checks.push(["Scoring matches the agent's rules (F, Midwest, same-day)", !!midwestF && Math.abs(midwestF.score - Math.round(expectF * 100) / 100) < 0.01, `F scores ${midwestF?.score}`]);
    // Like for like: orders shipped from their nearest warehouse, where the stock layout doesn't come into it.
    const nearIdx = w.orders.map((o, k) => (w.before[k].warehouse && !w.before[k].offNearest ? k : -1)).filter((k) => k >= 0);
    const calib = pct(nearIdx.filter((k) => w.before[k].onTime).length, nearIdx.length);
    const histPct = d.nearOnTime * 100;
    checks.push(["'Before', shipped from the nearest warehouse, matches history (within 4 pts)", Math.abs(calib - histPct) <= 4, `simulated ${f1(calib)} vs history ${f1(histPct)} on ${nearIdx.length} orders`]);
    if (stockMode === "history") {
      const histAll = d.histOnTime * 100;
      checks.push(["'Before' on time matches history (within 3 pts)", Math.abs(B.onTime - histAll) <= 3, `simulated ${f1(B.onTime)} vs history ${f1(histAll)}`]);
    }
    const sdHist = [...d.seg.entries()].filter(([k]) => k.startsWith("same_day|true|complete|false"))[0]?.[1].rate ?? 0;
    checks.push(["Same-day before 08:00 from the nearest warehouse is the best case", sdHist > 0.8, `history ${f1(sdHist * 100)}`]);
    for (const [label, ok, detail] of checks) say(`- ${ok ? "PASS" : "FAIL"} ${label} (${detail})`);

    if (askAgent) await agentCheck(d, w, say);

    say();
    say("## Assumptions");
    say(`- Clients answer an address question ${ASSUME.addressAnswered * 100}% of the time, within ${Math.min(...ASSUME.answerHours)}–${Math.max(...ASSUME.answerHours)} hours.`);
    say(`- ${Math.min(...ASSUME.cartons)}–${Math.max(...ASSUME.cartons)} cartons a line, 1–3 lines an order; no restocking during the week.`);
    if (stockMode === "history") say(`- Stock-outs at the nearest warehouse happen as often as in history; an approved AI transfer (FR-07) prevents ${ASSUME.transfersPrevent * 100}% of them. The data can't give this share (A8); at 0% the transfers add nothing.`);
    say(`- Afternoon wave (proposed, not built): same-day orders complete between the cutoff and ${String(ASSUME.waveLastMinute / 60).padStart(2, "0")}:00 are picked at 14:00, up to ${ASSUME.waveSlots} a warehouse a day (pick capacity isn't recorded, A7). They are judged like same-day orders picked that morning, scaled by how those did when collected at 15:00 or later: ${f1(d.lateShipOnTime * 100)} on time (factor ${d.waveFactor.toFixed(3)}); ${f1(d.lateShipShare * 100)} of collections run that late.`);
    say("- A same-day order moved to the next day is as likely on time as the dataset's next-day orders.");
    say(`- A carrier takes at most its historical daily volume in a region plus ${Math.round((ASSUME.capacityHeadroom - 1) * 100)}%; beyond that Halcyon books the next-best carrier.`);
    say(`- A carrier changes the on-time chance by its late rate into the region against the historical mix there; a late order costs $${ASSUME.lateCostUsd} to redeliver.`);
    say("- Destination cities are examples in the order's real region; the region is the dataset's.");

    if (out) {
      writeFileSync(out, lines.join("\n") + "\n");
      console.log(`\nWrote ${out}`);
    }
    if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

// Monday's same-day orders after the cutoff, sent to the real carrier agent in the API's shape; its recommended carrier
// for each order is compared with the scoring rules.
async function agentCheck(d: Data, w: ReturnType<typeof simulate>, say: (s?: string) => void) {
  const config = loadConfig();
  say();
  say("## Carrier agent check");
  if (!config.carrierAgent) {
    say("- SKIP FOUNDRY_CARRIER_AGENT_NAME isn't set.");
    return;
  }
  const monday = w.orders
    .map((o, k) => [o, w.halcyon[k]] as const)
    .filter(([o, x]) => o.day === start && x.sameDayPromised && x.warehouse)
    .slice(0, 8);
  const input = {
    orders: monday.map(([o, x]) => ({
      orderId: o.id,
      warehouseName: d.warehouses.find((v) => v.warehouse_id === x.warehouse)?.warehouse_name ?? null,
      destination: `${o.city}, ${o.state}`,
      region: o.region,
      shippingPriority: "Same-day",
    })),
    carriers: Object.keys(d.price).map((c) => ({
      carrierName: c,
      preferredSupplier: d.preferred[c],
      regionalLateDeliveryRates: d.late[c],
      averageShippingPrice: d.price[c],
      additionalCapacity: null,
      earliestPickup: null,
      latestSameDayPickup: null,
      sameDayServiceAvailable: null,
    })),
  };
  const reply = await createFoundryAgent(config.carrierAgent).ask(JSON.stringify(input, null, 2));
  const text = typeof reply.output === "string" ? reply.output : JSON.stringify(reply.output);
  let agree = 0;
  let unread = 0;
  for (const [o] of monday) {
    const block = text.split(/Order ID[*_]*\s*:/i).find((b) => b.trimStart().startsWith(o.id)) ?? "";
    const said = /Recommended Carrier[*_]*\s*:[*_\s]*(?:Carrier\s+)?([A-Z])\b/i.exec(block)?.[1]?.toUpperCase() ?? "?";
    const rule = rankCarriers(d, o.region, "same_day")[0].carrier;
    if (said === rule) agree++;
    if (said === "?") unread++;
    say(`- ${o.id} (${o.region}): agent ${said}, rules ${rule} ${said === rule ? "✓" : "✗"}`);
  }
  say(`- ${agree} of ${monday.length} agree.`);
  // Answers the parser couldn't read are a format problem, not a disagreement: show what came back.
  if (unread) say(`- The reply didn't match "Order ID: … Recommended Carrier: X". It began: ${JSON.stringify(text.slice(0, 400))}`);
}

await main();
