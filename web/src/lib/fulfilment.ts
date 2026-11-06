// Picks where an emailed order should ship from: the products the agent found, matched to the catalogue, and the
// warehouses ranked by miles to the delivery address's region, nearest with enough available stock first.
import type { ReadReply, ReplyProduct } from "./emails";
import type { Product } from "./products";
import type { Warehouse } from "./warehouses";

export type Region = keyof Warehouse["milesToRegion"];

const STATE_REGION: Record<string, Region> = {};
const add = (region: Region, states: string) => states.split(" ").forEach((s) => (STATE_REGION[s] = region));
add("Northeast", "ME NH VT MA RI CT NY NJ PA DE MD DC");
add("Southeast", "VA WV NC SC GA FL AL MS TN AR LA TX OK");
add("Midwest", "OH IN IL MI WI MN IA MO KS NE ND SD KY");
add("West", "MT WY CO NM AZ UT NV ID WA OR CA AK HI");

const STATE_NAMES: Record<string, string> = {
  maine: "ME", "new hampshire": "NH", vermont: "VT", massachusetts: "MA", "rhode island": "RI", connecticut: "CT",
  "new york": "NY", "new jersey": "NJ", pennsylvania: "PA", delaware: "DE", maryland: "MD", virginia: "VA",
  "west virginia": "WV", "north carolina": "NC", "south carolina": "SC", georgia: "GA", florida: "FL", alabama: "AL",
  mississippi: "MS", tennessee: "TN", arkansas: "AR", louisiana: "LA", texas: "TX", oklahoma: "OK", ohio: "OH",
  indiana: "IN", illinois: "IL", michigan: "MI", wisconsin: "WI", minnesota: "MN", iowa: "IA", missouri: "MO",
  kansas: "KS", nebraska: "NE", "north dakota": "ND", "south dakota": "SD", kentucky: "KY", montana: "MT",
  wyoming: "WY", colorado: "CO", "new mexico": "NM", arizona: "AZ", utah: "UT", nevada: "NV", idaho: "ID",
  washington: "WA", oregon: "OR", california: "CA", alaska: "AK", hawaii: "HI",
};

// By the ZIP code's first digit, when there's no state to go on.
const ZIP_REGION: Region[] = ["Northeast", "Northeast", "Southeast", "Southeast", "Midwest", "Midwest", "Midwest", "Southeast", "West", "West"];
const REGIONS: Region[] = ["Midwest", "Southeast", "Northeast", "West"];

const valueOf = (reply: ReadReply, pattern: RegExp) => reply.fields.find((f) => pattern.test(f.label) && f.value)?.value ?? null;

// The delivery region from the reply: a region field, then the state (field or "…, OH 43215" in the address), then
// the ZIP code. null when none of them says.
export function regionOf(reply: ReadReply): Region | null {
  const region = valueOf(reply, /region/);
  const named = REGIONS.find((r) => region?.toLowerCase() === r.toLowerCase());
  if (named) return named;

  const state = valueOf(reply, /^state|province/)?.trim();
  if (state) {
    const code = state.length === 2 ? state.toUpperCase() : STATE_NAMES[state.toLowerCase()];
    if (code && STATE_REGION[code]) return STATE_REGION[code];
  }
  const address = reply.fields.filter((f) => /address|city|state/.test(f.label) && f.value).map((f) => f.value).join(" ");
  const inline = /\b([A-Z]{2})\s+\d{5}\b/.exec(address)?.[1];
  if (inline && STATE_REGION[inline]) return STATE_REGION[inline];

  const zip = /\b(\d)\d{4}\b/.exec(valueOf(reply, /postal|zip|post code/) ?? address)?.[1];
  return zip ? ZIP_REGION[Number(zip)] : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const stockOf = (p: Product) => p.stock.reduce((sum, s) => sum + s.available, 0);

// The catalogue product the agent meant: same SKU or id, same name, or one name containing the other. Names repeat
// across clients' catalogues, so among equal matches the given client's product wins, then the one with most stock.
export function matchProduct(wanted: ReplyProduct, catalogue: Product[], clientId?: string): Product | null {
  const w = norm(wanted.name);
  if (!w) return null;
  const best = (matches: Product[]) =>
    matches.sort((a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId) || stockOf(b) - stockOf(a))[0];
  return (
    best(catalogue.filter((p) => norm(p.sku) === w || norm(p.productId) === w)) ??
    best(catalogue.filter((p) => norm(p.productName) === w)) ??
    best(catalogue.filter((p) => norm(p.productName).includes(w) || w.includes(norm(p.productName)))) ??
    null
  );
}

export interface OrderLine {
  wanted: ReplyProduct;
  product: Product | null;
  // Cartons asked for; 1 when the agent gave no usable quantity.
  quantity: number;
}

export interface WarehouseOption {
  warehouse: Warehouse;
  // null when the delivery region is unknown.
  miles: number | null;
  // Available cartons of each matched line here, in line order.
  available: number[];
  // Every matched line has enough available here.
  canShip: boolean;
}

export interface Fulfilment {
  region: Region | null;
  lines: OrderLine[];
  // In the agent's priority order when it gave one, else nearest first, else most stock first.
  options: WarehouseOption[];
  ranking: "agent" | "distance" | "stock";
  // The first warehouse in that order that can ship it all, if any.
  suggested: WarehouseOption | null;
}

export function planFulfilment(reply: ReadReply, catalogue: Product[], warehouses: Warehouse[]): Fulfilment {
  const region = regionOf(reply);
  const lines = reply.products.map((wanted): OrderLine => {
    const q = Number.parseInt(wanted.quantity ?? "", 10);
    return { wanted, product: matchProduct(wanted, catalogue), quantity: Number.isFinite(q) && q > 0 ? q : 1 };
  });
  const matched = lines.filter((l) => l.product);

  const options = warehouses
    .map((warehouse): WarehouseOption => {
      const available = matched.map((l) => l.product!.stock.find((s) => s.warehouseId === warehouse.warehouseId)?.available ?? 0);
      return {
        warehouse,
        miles: region ? warehouse.milesToRegion[region] : null,
        available,
        // No products to check (a ranking-only reply) means any warehouse will do.
        canShip: lines.length === 0 || (matched.length > 0 && matched.every((l, i) => available[i] >= l.quantity)),
      };
    })
    .sort((a, b) =>
      a.miles !== null && b.miles !== null
        ? a.miles - b.miles
        : b.available.reduce((x, y) => x + y, 0) - a.available.reduce((x, y) => x + y, 0),
    );

  // The agent's order wins; warehouses it didn't rank keep the order above, after the ranked ones.
  const rankOf = (o: WarehouseOption) => {
    const i = reply.priority.indexOf(o.warehouse.warehouseId);
    return i === -1 ? Infinity : i;
  };
  if (reply.priority.length) options.sort((a, b) => rankOf(a) - rankOf(b));

  const ranking = reply.priority.length ? "agent" : region ? "distance" : "stock";
  return { region, lines, options, ranking, suggested: options.find((o) => o.canShip) ?? null };
}
