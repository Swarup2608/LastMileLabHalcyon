// An order request's lines as Resolve sees them, for requests routed before the web app saved its lines with the
// decision: the products in the email agent's reply (same keys as the web app's readReply), each matched to the
// catalogue like matchProduct does, with staff's per-line fixes (edits.lines, keyed by the line's index) on top.
import { jsonOf } from "./agent-json.js";

const PRODUCTS_KEY = /product|item|line|order/i;
const NAME_KEYS = ["name", "product", "productName", "product_name", "item", "description", "sku", "productId", "product_id"];
const QTY_KEYS = ["quantity", "qty", "count", "units", "amount"];

export interface CatalogueEntry {
  productId: string;
  sku: string;
  productName: string;
  clientId: string;
  // Cartons available across every warehouse: the tie-break among equal matches.
  stock: number;
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());
const pick = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]).find((v) => !isEmpty(v));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// { name, quantity } for each product in the reply, in order.
export function replyProducts(output: unknown): { name: string; quantity: number | null }[] {
  if (typeof output === "string") output = jsonOf(output);
  const products: { name: string; quantity: number | null }[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const [key, value] of Object.entries(o as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const objects = value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
        if (objects.length && PRODUCTS_KEY.test(key)) {
          for (const p of objects) {
            const q = Number.parseInt(String(pick(p, QTY_KEYS) ?? ""), 10);
            products.push({ name: String(pick(p, NAME_KEYS) ?? ""), quantity: Number.isFinite(q) && q > 0 ? q : null });
          }
        }
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(output);
  return products;
}

// Same SKU or id, same name, or one name containing the other; the client's own product first, then most stock.
export function matchName(name: string, catalogue: CatalogueEntry[], clientId?: string | null) {
  const w = norm(name);
  if (!w) return null;
  const best = (m: CatalogueEntry[]) =>
    m.sort((a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId) || b.stock - a.stock)[0];
  return (
    best(catalogue.filter((p) => norm(p.sku) === w || norm(p.productId) === w)) ??
    best(catalogue.filter((p) => norm(p.productName) === w)) ??
    best(catalogue.filter((p) => norm(p.productName).includes(w) || w.includes(norm(p.productName)))) ??
    null
  );
}

type LineEdit = { productId?: string | null; declined?: boolean; quantity?: number | null };

// The request's matched lines: product id and cartons (1 when no quantity was given, as Resolve assumes).
export function replyLines(output: unknown, edits: Record<string, LineEdit> | undefined, catalogue: CatalogueEntry[], clientId?: string | null) {
  return replyProducts(output).flatMap((p, i) => {
    const edit = edits?.[String(i)] ?? {};
    if (edit.declined) return [];
    // null: staff said it matches nothing in the catalogue.
    const productId = edit.productId === null ? null : (edit.productId ?? matchName(p.name, catalogue, clientId)?.productId);
    const quantity = edit.quantity ?? p.quantity ?? 1;
    return productId && quantity > 0 ? [{ productId, quantity }] : [];
  });
}
