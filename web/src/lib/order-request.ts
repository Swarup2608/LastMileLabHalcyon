// An emailed order request as the Queue, Resolve and Thread screens (and the client's own pages) see it: what the
// agent read from the email, matched to the catalogue, plus what staff fixed by hand. The fixes, the questions asked,
// the client link and the routing are saved to the API (PUT /api/emails/:id/request), keyed by email id.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import { ApiError } from "./api";
import { emailsApi, readReply, scoreOf, type InboundEmail, type ReadReply } from "./emails";
import { matchProduct, planFulfilment } from "./fulfilment";
import { productsApi, type Product } from "./products";
import { warehousesApi, type Warehouse } from "./warehouses";

// The API's limit on one order line (MAX_ORDER_QUANTITY).
const MAX_QUANTITY = 100_000;

export type AskKey = "product" | "qty" | "address";
export const ASK_KEYS: AskKey[] = ["product", "qty", "address"];

export interface Address {
  street: string;
  suite: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}
export const ADDRESS_REQUIRED: (keyof Address)[] = ["street", "city", "region", "postal"];
const ADDRESS_LABEL: Record<keyof Address, string> = {
  street: "Street",
  suite: "Suite",
  city: "City",
  region: "State",
  postal: "Postal code",
  country: "Country",
};

export interface Line {
  key: string;
  // What the email asked for, as the agent read it.
  asked: string;
  product: Product | null;
  declined: boolean;
  quantity: number | null;
}

// What staff changed or decided on this request.
export interface RequestEdits {
  lines?: Record<string, { productId?: string | null; declined?: boolean; quantity?: number | null }>;
  address?: Partial<Address>;
  ask?: Partial<Record<AskKey, boolean>>;
  // When the questions marked in ask last changed; the client portal shows them from then, no email needed.
  askAt?: string;
  // auto: routed by useAutoRoute, not by staff. override: staff routed somewhere other than the suggested warehouse,
  // with the warnings they were shown.
  // lines: the matched products with the decision, which the API judges stock-outs at the nearest warehouse on.
  routed?: { warehouseIds: string[]; at: string; auto?: boolean; override?: string[]; lines?: DecisionLine[] };
  // Set when staff undo routing, so a complete request isn't routed again by itself.
  hold?: boolean;
  // text: the reply as sent, for the client's Messages page.
  asked?: { keys: AskKey[]; at: string; text?: string };
  // The client account, once staff picked one (null = unlinked); left out, it's the one the email matched.
  clientId?: string | null;
  // Set by the API when the client answered in the portal: their note, and per line what they meant.
  answered?: { at: string; note?: string; lines?: Record<string, string> };
  // answered.at once staff opened the request on Resolve after it, which clears it from Exceptions.
  answerReviewed?: string;
  // Order intake: when it first became ready to route. The same-day cutoff is judged against this; the API keeps the
  // first one it's given (order_requests.intake_at).
  intakeAt?: string;
  // Staff flagged the warehouse as out of stock and proposed a new delivery date; the client accepts or declines it in
  // the portal (the API sets status, respondedAt and response).
  stockFlag?: StockFlag;
}

// A matched line as saved with a routing decision or stock flag.
export interface DecisionLine {
  productId: string;
  quantity: number;
}

// The request's matched, not declined lines (one carton when no quantity is given, as routing assumes).
export const decisionLines = (request: OrderRequest, keys?: string[]): DecisionLine[] =>
  request.lines
    .filter((l) => l.product && !l.declined && (!keys || keys.includes(l.key)))
    .map((l) => ({ productId: l.product!.productId, quantity: l.quantity && l.quantity > 0 ? l.quantity : 1 }));

export interface StockFlag {
  warehouseId: string;
  // The lines it's about.
  lines?: DecisionLine[];
  // "Compact lamp ×10", one per item that's short.
  items: string[];
  // "YYYY-MM-DD"
  originalDate: string;
  newDate: string;
  // The message as sent to the customer, and whether the draft came from the AI agent or the template.
  message: string;
  source: "ai" | "template";
  at: string;
  status: "pending" | "accepted" | "declined";
  respondedAt?: string;
  // The client's note when answering.
  response?: string;
}

export interface OrderRequest {
  email: InboundEmail;
  ref: string;
  sender: { name: string; email: string };
  // Where replies go: an address the customer gave in the email (or the agent read from it) comes first, and the
  // sender's address is kept as the secondary; with none given, the sender is primary and there's no secondary.
  contact: { primary: string; secondary: string | null; fromBody: boolean };
  customer: string | null;
  // The client account it belongs to, and whether that came from the email (a client login) rather than staff.
  clientId: string | null;
  clientAuto: boolean;
  reply: ReadReply;
  score: number | null;
  lines: Line[];
  address: Address;
  resolved: Record<AskKey, boolean>;
  // Short labels of what still stops it shipping, for the queue's chips.
  blockers: string[];
  status: "agent" | "needs" | "asked" | "ready" | "routed";
}

// "Swarup M.N.S <swarup@example.com>" into its name and address.
export function parseSender(from: string) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
  return { name: from.trim() || "Unknown sender", email: from.trim() };
}

export const initials = (name: string) =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

const fieldOf = (reply: ReadReply, pattern: RegExp) => reply.fields.find((f) => pattern.test(f.label) && f.value)?.value ?? "";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// The customer's own address: one the agent read from the email, else the first one written in the body, never the
// sender's or the Halcyon inbox's own.
function contactOf(email: InboundEmail, reply: ReadReply, sender: { email: string }) {
  const own = new Set([sender.email.toLowerCase(), email.mailbox.toLowerCase()]);
  const candidates = [
    ...reply.fields.filter((f) => /e ?mail/.test(f.label) && f.value).flatMap((f) => f.value!.match(EMAIL) ?? []),
    ...((email.body ?? email.snippet).match(EMAIL) ?? []),
  ];
  const given = candidates.find((c) => !own.has(c.toLowerCase()));
  return given
    ? { primary: given, secondary: sender.email, fromBody: true }
    : { primary: sender.email, secondary: null, fromBody: false };
}

export function buildRequest(email: InboundEmail, catalogue: Product[], edits: RequestEdits = {}): OrderRequest {
  const reply = readReply(email.aiResult?.output);
  const sender = parseSender(email.from);
  const clientAuto = edits.clientId === undefined;
  const clientId = clientAuto ? email.matchedClientId : (edits.clientId ?? null);

  const lines = reply.products.map((p, i): Line => {
    const key = String(i);
    const edit = edits.lines?.[key] ?? {};
    const q = Number.parseInt((p.quantity ?? "").replace(/,/g, ""), 10);
    const product =
      edit.productId === undefined
        ? matchProduct(p, catalogue, clientId ?? undefined)
        : edit.productId === null
          ? null
          : (catalogue.find((c) => c.productId === edit.productId) ?? null);
    return {
      key,
      asked: p.name,
      product,
      declined: !!edit.declined,
      // Over the API's limit isn't an order quantity: staff settle it, so it can't route itself.
      quantity: edit.quantity !== undefined ? edit.quantity : Number.isFinite(q) && q > 0 && q <= MAX_QUANTITY ? q : null,
    };
  });

  const address: Address = {
    street: fieldOf(reply, /^address$/),
    suite: fieldOf(reply, /suite|unit|apartment|apt/),
    city: fieldOf(reply, /^city$/),
    region: fieldOf(reply, /^state$/),
    postal: fieldOf(reply, /^postal code$/),
    country: fieldOf(reply, /country/),
    ...edits.address,
  };
  // A one-line address keeps only its street once city, state and ZIP are split out of it.
  if (!edits.address?.street && address.city && address.street.includes(",")) address.street = address.street.split(",")[0].trim();

  const live = lines.filter((l) => !l.declined);
  const resolved = {
    product: lines.length > 0 && lines.every((l) => l.product || l.declined),
    qty: lines.length > 0 && live.every((l) => (l.quantity ?? 0) > 0),
    address: ADDRESS_REQUIRED.every((k) => address[k].trim()),
  };

  const blockers: string[] = [];
  if (!lines.length) blockers.push("Product");
  if (lines.some((l) => !l.product && !l.declined)) blockers.push("Not in catalogue");
  if (lines.length && !resolved.qty) blockers.push("Quantity");
  const gaps = ADDRESS_REQUIRED.filter((k) => !address[k].trim());
  if (gaps.length === ADDRESS_REQUIRED.length) blockers.push("Shipping address");
  else blockers.push(...gaps.map((k) => ADDRESS_LABEL[k]));

  const status = !email.readByAi
    ? "agent"
    : edits.routed
      ? "routed"
      : !blockers.length
        ? "ready"
        : edits.asked
          ? "asked"
          : "needs";

  return {
    email,
    ref: `REQ-${email.id.slice(-6).toUpperCase()}`,
    sender,
    contact: contactOf(email, reply, sender),
    customer: fieldOf(reply, /^(customer|full name|name|customer name|contact)$/) || null,
    clientId,
    clientAuto,
    reply,
    score: scoreOf(email.aiResult?.output),
    lines,
    address,
    resolved,
    blockers,
    status,
  };
}

// The resolved order as a reply planFulfilment can rank warehouses for.
export function planFor(request: OrderRequest, catalogue: Product[], warehouses: Warehouse[]) {
  const shipping = request.lines.filter((l) => l.product && !l.declined);
  return planFulfilment(
    {
      fields: [
        { label: "address", value: request.address.street || null },
        { label: "city", value: request.address.city || null },
        { label: "state", value: request.address.region || null },
        { label: "postal code", value: request.address.postal || null },
      ],
      products: shipping.map((l) => ({ name: l.product!.sku, quantity: String(l.quantity ?? 1) })),
      missing: [],
      priority: request.reply.priority,
    },
    catalogue,
    warehouses,
  );
}

// The warehouse a complete request ships from without anyone choosing: the first in the ranking with every item in
// stock, once product, quantity and a full address with a known region are in. null when anything is missing, no one
// warehouse has it all (it waits in Ready to route), or staff undid routing.
export function autoRouteOf(request: OrderRequest, edits: RequestEdits, catalogue: Product[], warehouses: Warehouse[]) {
  if (request.status !== "ready" || edits.hold || !request.lines.some((l) => l.product && !l.declined)) return null;
  const plan = planFor(request, catalogue, warehouses);
  return plan.region && plan.suggested ? plan.suggested.warehouse : null;
}

// Records the order intake time on each request that is ready to route and has none yet: the moment it was accepted,
// which the same-day cutoff is judged against. Only a request seen as ready gets one, so one with an unknown address
// never does; requests routed before intake times existed keep none rather than a made-up one.
export function stampIntake(requests: OrderRequest[]) {
  const all = snapshot();
  const at = new Date().toISOString();
  for (const r of requests) {
    const edits = all[r.email.id] ?? NO_EDITS;
    if (r.status === "ready" && !edits.intakeAt) saveEdits(r.email.id, { ...edits, intakeAt: at });
  }
}

// Routes every request autoRouteOf picks a warehouse for. Waits until edits settle, so a postal code being typed
// isn't routed after its first digit.
export function useAutoRoute(
  requests: OrderRequest[] | null,
  stock: { products: Product[]; warehouses: Warehouse[] } | null,
  onRouted?: (routed: { request: OrderRequest; warehouse: Warehouse }[]) => void,
) {
  useEffect(() => {
    if (!requests || !stock) return;
    const t = setTimeout(() => {
      stampIntake(requests);
      const all = snapshot();
      const at = new Date().toISOString();
      const routed = requests.flatMap((request) => {
        const edits = all[request.email.id] ?? NO_EDITS;
        const warehouse = autoRouteOf(request, edits, stock.products, stock.warehouses);
        if (!warehouse) return [];
        saveEdits(request.email.id, {
          ...edits,
          routed: { warehouseIds: [warehouse.warehouseId], at, auto: true, lines: decisionLines(request) },
        });
        return [{ request, warehouse }];
      });
      if (routed.length) onRouted?.(routed);
    }, 1500);
    return () => clearTimeout(t);
    // onRouted is a fresh closure each render; the requests changing is what should restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, stock]);
}

// One line per thing to ask for, in ASK_KEYS order: what the reply asks and the client portal shows.
export function questionsFor(request: OrderRequest, keys: AskKey[]): string[] {
  const unmatched = request.lines.filter((l) => !l.product && !l.declined);
  const noQty = request.lines.filter((l) => !l.declined && !(l.quantity && l.quantity > 0));
  const gaps = ADDRESS_REQUIRED.filter((k) => !request.address[k].trim());
  const items: Record<AskKey, string> = {
    product: unmatched.length
      ? `Which ${unmatched.map((l) => `“${l.asked}”`).join(" and ")} you’d like. ${unmatched.length === 1 ? "It doesn’t" : "They don’t"} match an item in our catalogue, so a brand and model, or a link, would help.`
      : "Which products you’d like to order.",
    qty: noQty.length
      ? `How many ${noQty.map((l) => l.product?.productName ?? l.asked).join(" and ")} you need. We’ll assume one unless you tell us otherwise.`
      : "How many of each item you need.",
    address:
      gaps.length === ADDRESS_REQUIRED.length || !gaps.length
        ? "Your full shipping address: street, suite or unit if any, city, state, postal code and country."
        : `The ${gaps.map((k) => ADDRESS_LABEL[k].toLowerCase()).join(" and ")} for your shipping address.`,
  };
  return ASK_KEYS.filter((k) => keys.includes(k)).map((k) => items[k]);
}

// The questions for the customer, in a reply they can answer in one go.
export function draftReply(request: OrderRequest, keys: AskKey[]): string {
  if (!keys.length) return "";
  const first = (request.customer ?? request.sender.name).split(/\s+/)[0];
  return `Hi ${first},\n\nThanks for your order request. Before we can ship it, we need a little more from you:\n\n${questionsFor(request, keys)
    .map((q) => `• ${q}`)
    .join("\n")}\n\nReply to this email and we’ll get it moving.\n\nBest,\nHalcyon Orders`;
}

type AllEdits = Record<string, RequestEdits>;
const NONE: AllEdits = {};
const NO_EDITS: RequestEdits = {};

// Edits the API hasn't confirmed yet, kept in this browser so a failed save or a closed tab doesn't lose them;
// seedEdits sends them again. It's the key edits lived under before the API kept them, so those go up the same way.
const OUTBOX_KEY = "halcyon.requests.v1";
// Saves wait this long after the last change, so typing an address sends one request rather than one per key.
const SAVE_DELAY = 600;

// The edits as an external store over the API: seeded from each email as it loads, changed here by staff (screens
// update at once) and saved to the API shortly after. A request with a save pending keeps its local edits when the
// emails reload.
let cache: AllEdits = NONE;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const snapshot = () => cache;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readOutbox(): AllEdits {
  try {
    return (JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "null") as AllEdits | null) ?? {};
  } catch {
    return {};
  }
}

function writeOutbox(id: string, edits: RequestEdits | null) {
  try {
    const all = readOutbox();
    if (edits) all[id] = edits;
    else delete all[id];
    if (Object.keys(all).length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(all));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // Blocked storage: the edits still save to the API, they just aren't kept if that fails.
  }
}

// Takes in the edits the API has for these emails. Edits still in the outbox are newer than the API's, so they win and
// are sent again.
export function seedEdits(emails: InboundEmail[]) {
  const unsent = readOutbox();
  let next = cache;
  const resend: [string, RequestEdits][] = [];
  for (const email of emails) {
    if (pending.has(email.id)) continue;
    const local = unsent[email.id];
    if (local) resend.push([email.id, local]);
    const value = local ?? email.edits ?? NO_EDITS;
    if (JSON.stringify(next[email.id] ?? NO_EDITS) !== JSON.stringify(value)) next = { ...next, [email.id]: value };
  }
  if (next !== cache) {
    cache = next;
    notify();
  }
  for (const [id, edits] of resend) saveEdits(id, edits);
}

// Replaces one request's edits; every screen showing it updates now, and the API shortly after. Until the API has
// them, they wait in the outbox.
export function saveEdits(id: string, edits: RequestEdits) {
  cache = { ...cache, [id]: edits };
  notify();
  writeOutbox(id, edits);
  clearTimeout(pending.get(id));
  pending.set(
    id,
    setTimeout(() => {
      const sent = cache[id] ?? NO_EDITS;
      emailsApi.saveRequest(id, sent).then(
        () => {
          pending.delete(id);
          // A change made while this was in flight stays in the outbox for its own save.
          if (cache[id] === sent) writeOutbox(id, null);
        },
        (err) => {
          pending.delete(id);
          // The API refused these edits (an address hold, a quantity over the limit), so sending them again can't work.
          if (err instanceof ApiError && err.status === 400) {
            writeOutbox(id, null);
            toast.error(`${err.reasons()} Reload to see what was saved.`, { id: "request-save" });
            return;
          }
          // One toast however many saves failed together; the edits stay in the outbox and are sent again next load.
          toast.error("We couldn’t save your changes to this request. They’ll be sent again when you reload.", { id: "request-save" });
        },
      );
    }, SAVE_DELAY),
  );
}

// Every request's edits, for the queue.
export const useAllEdits = () => useSyncExternalStore(subscribe, snapshot, () => NONE);

// One request's edits and a setter that merges and saves them.
export function useRequestEdits(id: string) {
  const all = useAllEdits();
  const edits = all[id] ?? NO_EDITS;
  const update = useCallback((change: (e: RequestEdits) => RequestEdits) => saveEdits(id, change(snapshot()[id] ?? NO_EDITS)), [id]);
  return [edits, update] as const;
}

// The catalogue and warehouses, for matching products and ranking warehouses; null while loading.
export function useStock() {
  const [stock, setStock] = useState<{ products: Product[]; warehouses: Warehouse[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([productsApi.list(), warehousesApi.list()]).then(
      ([p, w]) => active && setStock({ products: p.products, warehouses: w.warehouses }),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);
  return { stock, failed };
}

export const totalAvailable = (p: Product) => p.stock.reduce((sum, s) => sum + s.available, 0);

// "Oct 29, 4:33 AM"
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
