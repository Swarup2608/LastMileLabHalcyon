// Emails: /api/emails, the mail received by the polled Gmail inbox and the Foundry agent's reply to each. Staff only.
import { request } from "./api";
import type { RequestEdits } from "./order-request";
import type { OrderAssignment } from "./carrier-plan";
import type { ExpectedDelivery } from "./settings";

export interface AgentResult {
  agent: string;
  conversationId: string;
  // The agent's reply: parsed JSON when it answered in JSON, otherwise its text.
  output: unknown;
}

export interface InboundEmail {
  id: string;
  // "api": an order placed through the API, with no email; its order is aiResult.output, already in the agent's shape.
  channel: "email" | "api";
  threadId: string | null;
  mailbox: string;
  from: string;
  subject: string;
  snippet: string;
  // null for emails stored before the body was kept; snippet is all there is then.
  body: string | null;
  date: string | null;
  receivedAt: string;
  ingestedAt: string;
  readByAi: boolean;
  aiResult: AgentResult | null;
  aiReadAt: string | null;
  // Quantities the agent read that are over the limit for one line.
  quantityWarnings?: string[];
  // The client whose login sent the email or is written in it; null when none is.
  matchedClientId: string | null;
  // Staff's work on the request; clientId is in it only once staff linked or unlinked a client. null until then.
  edits: RequestEdits | null;
  // Same day when received before the admin's cutoff, else the next day.
  expectedDelivery: ExpectedDelivery;
  // The carrier staff assigned it to; null until then.
  carrier: OrderAssignment | null;
  // Out of the queue, and why; null while it's in the queue. duplicateOf: the email a repeat repeats.
  ignored: { reason: IgnoredReason; duplicateOf: string | null; at: string | null } | null;
}

export type IgnoredReason = "blank" | "duplicate" | "not_order" | "staff";

export const IGNORED_LABEL: Record<IgnoredReason, string> = {
  blank: "Blank email",
  duplicate: "Repeat of an earlier email",
  not_order: "No order found",
  staff: "Ignored by staff",
};

export interface EmailPage {
  emails: InboundEmail[];
  total: number;
  // How many of all `total` emails the agent has answered for.
  analyzed: number;
  // How many of all `total` are out of the queue.
  ignored: number;
  limit: number;
  offset: number;
}

export const emailsApi = {
  list: (limit: number, offset: number) => request<EmailPage>("/emails", { query: { limit, offset } }),
  get: (id: string) => request<{ email: InboundEmail }>(`/emails/${encodeURIComponent(id)}`),
  // Sends every email the agent hasn't read yet now, instead of waiting for the next poll.
  analyze: () => request<{ analyzed: number; failed: number }>("/emails/analyze", { method: "POST" }),
  // Leaving clientId out of edits leaves the client to the email's match; null unlinks it.
  saveRequest: (id: string, edits: RequestEdits) =>
    request<void>(`/emails/${encodeURIComponent(id)}/request`, {
      method: "PUT",
      body: { edits, clientId: edits.clientId, intakeAt: edits.intakeAt },
    }),
  // Takes an email out of the queue (ignore) or puts it back (restore).
  setIgnored: (id: string, ignore: boolean) =>
    request<void>(`/emails/${encodeURIComponent(id)}/ignored`, { method: "PUT", body: { ignore } }),
  // Drafts the out-of-stock message proposing a new date: by the AI draft agent when the API has one, else a template.
  stockDraft: (id: string, body: StockDraftRequest) =>
    request<{ message: string; source: "ai" | "template" }>(`/emails/${encodeURIComponent(id)}/stock-flag/draft`, { method: "POST", body }),
};

export interface StockDraftRequest {
  customer: string;
  ref: string;
  items: string[];
  warehouse: string;
  originalDate: string;
  newDate: string;
  reason?: string;
}

// The signed-in client's own order requests, emailed or placed through the API (client users only).
export const orderRequestsApi = {
  mine: () => request<{ emails: InboundEmail[] }>("/order-requests"),
  // Places an order through the API; products must be from the client's own catalogue.
  create: (body: NewOrder) =>
    request<{ id: string; ref: string; expectedDelivery: ExpectedDelivery; order: InboundEmail; warning?: string }>("/order-requests", { method: "POST", body }),
  // The client's answers to what staff asked; productId must be from their own catalogue.
  answer: (id: string, body: RequestAnswers) =>
    request<void>(`/order-requests/${encodeURIComponent(id)}/answers`, { method: "POST", body }),
  // The client's answer to a new delivery date proposed after a stock problem.
  respondStock: (id: string, decision: "accept" | "decline", note?: string) =>
    request<void>(`/order-requests/${encodeURIComponent(id)}/stock-flag`, { method: "POST", body: { decision, ...(note ? { note } : {}) } }),
};

export interface NewOrder {
  reference?: string;
  customer?: string;
  lines: { productId: string; quantity: number }[];
  address: { street: string; suite?: string; city: string; region: string; postal: string; country?: string };
  notes?: string;
}

export interface RequestAnswers {
  address?: Partial<Record<"street" | "suite" | "city" | "region" | "postal" | "country", string>>;
  // Keyed by the request's line key.
  lines?: Record<string, { quantity?: number; productId?: string; note?: string }>;
  note?: string;
}

const SCORE_KEY = /confidence|score|percent|probability|likelihood/i;
const PRODUCTS_KEY = /product|item|line|order/i;
const MISSING_KEY = /missing/i;
const NAME_KEYS = ["name", "product", "productName", "product_name", "item", "description", "sku", "productId", "product_id"];
const QTY_KEYS = ["quantity", "qty", "count", "units", "amount"];

export interface ReplyField {
  // The reply's key made readable: "postal_code" and "postalCode" both become "postal code".
  label: string;
  // null when the agent left it empty or listed it as missing.
  value: string | null;
}

export interface ReplyProduct {
  name: string;
  quantity: string | null;
}

export interface ReadReply {
  // The four delivery fields first, always (value null when missing), then any other field that has a value.
  fields: ReplyField[];
  products: ReplyProduct[];
  // What a shipment can't go without and the reply doesn't give: delivery field labels, and "products" when none.
  // Empty when the reply doesn't try to extract an order at all (e.g. it's only a warehouse ranking).
  missing: string[];
  // Warehouse ids in the agent's ranked order ([{ priority: 1, warehouseId: "W5" }, …]), best first; [] when none.
  priority: string[];
}

const PRIORITY_KEYS = ["priority", "rank", "order", "position"];
const WAREHOUSE_KEYS = ["warehouseId", "warehouse_id", "warehouse", "id"];

// A ranked warehouse list, sorted by its priority (list order when it has none); null when `value` isn't one.
function priorityOf(value: unknown[]): string[] | null {
  const ranked = value.map((v, i) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const id = pick(o, WAREHOUSE_KEYS);
    if (typeof id !== "string" || !/^W\d+$/i.test(id)) return null;
    const p = Number(pick(o, PRIORITY_KEYS));
    return { id: id.toUpperCase(), rank: Number.isFinite(p) ? p : i + 1 };
  });
  if (!ranked.length || ranked.some((r) => r === null)) return null;
  return (ranked as { id: string; rank: number }[]).sort((a, b) => a.rank - b.rank).map((r) => r.id);
}

// The fields a shipment needs, whatever the agent called them ("zip", "postalCode", "shipping.postcode"…).
const DELIVERY: { label: string; matches: RegExp }[] = [
  { label: "address", matches: /^(?!.*\b(e ?mail|city|state|zip|postal)\b).*\b(address|street)\b|\bline 1\b/ },
  { label: "city", matches: /\b(city|town)\b/ },
  { label: "state", matches: /\b(state|province)\b/ },
  { label: "postal code", matches: /\b(postal|zip|post ?code|pin ?code)\b/ },
];
// The agent's verdict about a field ("address_status": "UNVERIFIED", "addressComplete": false), not part of it.
const VERDICT_KEY = /\b(status|verified|verification|valid|validation|validity|complete|completeness|flag|check|confidence|quality|notes?|reason)\b/;
// A verdict word in a value: never a street, city or ZIP.
const VERDICT_VALUE = /^(un)?(verified|valid|invalid|complete|incomplete|confirmed|unconfirmed|ok|pending|partial)$/i;
// Bookkeeping the agent may echo back, not worth showing.
const NOISE = /\b(id|message id|conversation|mailbox|thread)\b/;

// "12 Main St, Boston, MA 02108" (ZIP optional) into its city, state and ZIP.
const ONE_LINE = /,\s*([^,]+?),\s*([A-Za-z][A-Za-z .]*?)\.?(?:\s+(\d{5}(?:-\d{4})?))?\s*$/;

export const labelOf = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();

const isEmpty = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" &&
    (!v.trim() || /^(missing|unknown|incomplete|n\/?a|none|null|not (given|provided|specified|stated)|tbd|-+|\?+)$/i.test(v.trim())));
const pick = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]).find((v) => !isEmpty(v));

// The JSON in a reply the API kept as text because it didn't parse: wrapped in ```json fences or prose, or with a
// closing bracket that doesn't match what it closes ("]" ending an object), as the agent sometimes writes. null when
// there's still no JSON in it.
export function jsonOf(text: string): unknown {
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start === -1 || end < start) return null;
  const body = text.slice(start, end + 1);
  for (const candidate of [body, matchBrackets(body)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next repair.
    }
  }
  return null;
}

// Rewrites each closing bracket outside a string to the one its opening bracket needs.
function matchBrackets(s: string) {
  const closers: string[] = [];
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      closers.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      out += closers.pop() ?? ch;
      continue;
    }
    out += ch;
  }
  return out;
}

// The reply as an object when it's JSON or text holding (repairable) JSON; anything else as it is.
const structured = (output: unknown) => (typeof output === "string" ? (jsonOf(output) ?? output) : output);

// Splits the agent's JSON reply (nested objects flattened) into the delivery address, the products with quantities
// and any other field that has a value. Only the delivery fields and the products count as missing: when empty, when
// they say "missing", or when a `missing…` list names them. City, state and ZIP are filled from a one-line address
// when the reply has no separate fields for them. A ranked warehouse list, at the top level or under any key, becomes
// `priority`. Score fields are left out; scoreOf shows them. Text replies have none of this.
export function readReply(output: unknown): ReadReply {
  const fields: ReplyField[] = [];
  const products: ReplyProduct[] = [];
  const missing = new Set<string>();
  let priority: string[] = [];
  output = structured(output);
  if (Array.isArray(output)) output = { warehouses: output };
  if (!output || typeof output !== "object") return { fields, products, missing: [], priority };

  const walk = (o: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(o)) {
      if (SCORE_KEY.test(key)) continue;
      const ranked = Array.isArray(value) && !priority.length ? priorityOf(value) : null;
      if (ranked) {
        priority = ranked;
      } else if (MISSING_KEY.test(key) && Array.isArray(value)) {
        for (const m of value) if (typeof m === "string") missing.add(labelOf(m));
      } else if (Array.isArray(value)) {
        const objects = value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
        if (objects.length && PRODUCTS_KEY.test(key)) {
          for (const p of objects) {
            const qty = pick(p, QTY_KEYS);
            products.push({ name: String(pick(p, NAME_KEYS) ?? "Unnamed product"), quantity: qty === undefined ? null : String(qty) });
          }
        } else if (value.every((v) => typeof v !== "object" || v === null)) {
          fields.push({ label: labelOf(key), value: value.length ? value.join(", ") : null });
        } else {
          fields.push({ label: labelOf(key), value: JSON.stringify(value) });
        }
      } else if (value && typeof value === "object") {
        walk(value as Record<string, unknown>);
      } else {
        fields.push({ label: labelOf(key), value: isEmpty(value) ? null : String(value) });
      }
    }
  };
  walk(output as Record<string, unknown>);

  const deliveryOf = (label: string) => (VERDICT_KEY.test(label) ? undefined : DELIVERY.find((d) => d.matches.test(label))?.label);
  for (const f of fields) if (f.value && VERDICT_VALUE.test(f.value.trim()) && deliveryOf(f.label)) f.value = null;
  const listedMissing = new Set([...missing].map(deliveryOf).filter(Boolean));
  const delivery = new Map<string, string | null>(DELIVERY.map((d) => [d.label, null]));
  for (const f of fields) {
    const d = deliveryOf(f.label);
    if (d && f.value && !delivery.get(d) && !listedMissing.has(d)) delivery.set(d, f.value);
  }

  const parts = ONE_LINE.exec(delivery.get("address") ?? "");
  if (parts) {
    const [, city, state, zip] = parts;
    if (!delivery.get("city") && !listedMissing.has("city")) delivery.set("city", city.trim());
    if (!delivery.get("state") && !listedMissing.has("state")) delivery.set("state", state.trim());
    if (zip && !delivery.get("postal code") && !listedMissing.has("postal code")) delivery.set("postal code", zip);
  }

  const extras = fields.filter((f) => f.value && !deliveryOf(f.label) && !NOISE.test(f.label));
  // A reply with no address, products or missing list isn't an order extraction, so nothing in it is "missing".
  const extracted = products.length > 0 || missing.size > 0 || [...delivery.values()].some(Boolean);
  return {
    fields: extracted ? [...[...delivery].map(([label, value]) => ({ label, value })), ...extras] : extras,
    products,
    missing: extracted
      ? [...[...delivery].filter(([, v]) => !v).map(([label]) => label), ...(products.length ? [] : ["products"])]
      : [],
    priority,
  };
}

// The first score-like field in the agent's reply (top level first, then nested objects) as 0–100, or null.
// Accepts 0.87, 87 and "87%"; values up to 1 are read as fractions.
export function scoreOf(output: unknown): number | null {
  output = structured(output);
  if (!output || typeof output !== "object") return null;
  const entries = Object.entries(output as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!SCORE_KEY.test(key)) continue;
    const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
    if (Number.isFinite(n)) return Math.min(100, Math.max(0, n <= 1 ? n * 100 : n));
  }
  for (const [, value] of entries) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = scoreOf(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}
