// Reading the email agent's reply, which the API keeps as text when it isn't valid JSON. Same repairs and field names as
// the web app's lib/emails.ts (jsonOf, DELIVERY), so the API reads an order's address as staff see it on Resolve.

// The most cartons one order line can hold, whichever way the order came in.
export const MAX_ORDER_QUANTITY = 100_000;
export const TOO_MANY_CARTONS = "Too big: max 100,000";

// The JSON in a reply: wrapped in ```json fences or prose, or with a closing bracket that doesn't match what it closes
// ("]" ending an object), as the agent sometimes writes. null when there's still no JSON in it.
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

const QTY_KEY = /^(quantity|qty|count|units|amount)$/i;
const NAME_KEYS = ["sku", "name", "product", "productName", "product_name", "item", "description", "productId", "product_id"];

// One line per quantity the agent read that is over the limit, anywhere in the reply. It's what the email asked for, so
// it stays as read and staff settle it; the portal won't take it as the order's quantity.
export function oversizedQuantities(output: unknown): string[] {
  if (typeof output === "string") output = jsonOf(output);
  if (!output || typeof output !== "object") return [];
  const found = Object.values(output).flatMap((v) => (v && typeof v === "object" ? oversizedQuantities(v) : []));
  const record = output as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    const quantity = QTY_KEY.test(k) ? Number(String(v).replace(/,/g, "")) : NaN;
    if (quantity > MAX_ORDER_QUANTITY) {
      const name = NAME_KEYS.map((n) => record[n]).find((n) => typeof n === "string" && n) ?? "A line";
      found.push(`${name}: ${quantity.toLocaleString("en-US")} cartons is over the ${MAX_ORDER_QUANTITY.toLocaleString("en-US")} limit`);
    }
  }
  return found;
}

// "stateOrRegion" → "state or region".
const labelOf = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();

// The agent's verdict about a field ("addressStatus": "COMPLETE"), not part of it.
const VERDICT_KEY = /\b(status|verified|verification|valid|validation|validity|complete|completeness|flag|check|confidence|quality|notes?|reason)\b/;
const EMPTY = /^(missing|unknown|incomplete|n\/?a|none|null|not (given|provided|specified|stated)|tbd|-+|\?+)$/i;

export const FIELD = {
  city: /\b(city|town)\b/,
  state: /\b(state|province)\b/,
  postal: /\b(postal|zip|post ?code|pin ?code)\b/,
  region: /\bregion\b/,
};

// The first value under a key whose label matches `field`, anywhere in the reply (an object, or text holding JSON).
export function fieldOf(output: unknown, field: RegExp): string {
  if (typeof output === "string") output = jsonOf(output);
  if (!output || typeof output !== "object") return "";
  for (const [k, v] of Object.entries(output)) {
    const label = labelOf(k);
    if (field.test(label) && !VERDICT_KEY.test(label) && typeof v === "string" && v.trim() && !EMPTY.test(v.trim())) return v.trim();
  }
  for (const v of Object.values(output)) {
    const inner = v && typeof v === "object" ? fieldOf(v, field) : "";
    if (inner) return inner;
  }
  return "";
}
