import { ADDRESS_REQUIRED, ASK_KEYS, planFor, type OrderRequest, type RequestEdits } from "@/lib/order-request";
import type { Product } from "@/lib/products";
import type { Warehouse } from "@/lib/warehouses";

// How long a question can wait for the customer before it's chased.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type EmailExceptionKind = "address" | "product" | "qty" | "stock" | "answered" | "stale";

// The Exceptions page's cards: what's wrong with the order (address, products), or with the conversation (email).
export type ExceptionGroup = "address" | "product" | "email";
export const GROUP_OF: Record<EmailExceptionKind, ExceptionGroup> = {
  address: "address",
  product: "product",
  qty: "product",
  stock: "product",
  answered: "email",
  stale: "email",
};

export interface EmailException {
  kind: EmailExceptionKind;
  request: OrderRequest;
  // Since when it has needed a person, ISO.
  since: string;
  // One line on what's wrong.
  detail: string;
}

// Most urgent first within a card.
export const EXCEPTION_ORDER: EmailExceptionKind[] = ["answered", "stale", "address", "product", "qty", "stock"];

const POSTAL_WORDS: Record<string, string> = { street: "street", city: "city", region: "state", postal: "postal code" };

// The emailed orders that need a person, oldest first within each kind:
// - answered: the customer answered in the portal and no one has opened it on Resolve since;
// - stock: everything is in but no one warehouse has it all, so it can't route itself;
// - address, product, qty: something is missing and nothing has been asked of the customer. One entry per order: the
//   address first (it's what picking a warehouse waits on), then the product, then the quantity, so an order missing
//   both an address and a product sits under Address until the address is in, then moves to Product;
// - stale: asked (by email or in the portal) over a day ago with no answer since.
export function emailExceptions(
  requests: OrderRequest[],
  editsOf: (id: string) => RequestEdits,
  catalogue: Product[],
  warehouses: Warehouse[],
  now = Date.now(),
): EmailException[] {
  const out: EmailException[] = [];
  for (const r of requests) {
    if (r.status === "agent" || r.status === "routed") continue;
    const edits = editsOf(r.email.id);
    if (edits.answered && edits.answerReviewed !== edits.answered.at) {
      out.push({ kind: "answered", request: r, since: edits.answered.at, detail: "Answered in the portal; review their answers" });
      continue;
    }
    if (r.status === "ready") {
      if (edits.hold || !r.lines.some((l) => l.product && !l.declined)) continue;
      const plan = planFor(r, catalogue, warehouses);
      if (!plan.suggested)
        out.push({ kind: "stock", request: r, since: r.email.receivedAt, detail: "No single warehouse has all of it; split it or wait for stock" });
      continue;
    }
    const marked = ASK_KEYS.some((k) => edits.ask?.[k] && !r.resolved[k]);
    const askedAt = edits.asked?.at ?? (marked ? edits.askAt : undefined);
    if (!askedAt && !marked) {
      const since = r.email.receivedAt;
      const unmatched = r.lines.filter((l) => !l.product && !l.declined);
      const qtyMissing = r.lines.length > 0 && !r.resolved.qty;
      // What else is missing, for the detail line of the card it shows in.
      const also = (parts: (string | false)[]) => {
        const rest = parts.filter(Boolean);
        return rest.length ? ` · also ${rest.join(" and ")}` : "";
      };
      if (!r.resolved.address) {
        const gaps = ADDRESS_REQUIRED.filter((k) => !r.address[k].trim());
        const what = gaps.length === ADDRESS_REQUIRED.length ? "No shipping address" : `Missing the ${gaps.map((k) => POSTAL_WORDS[k]).join(" and ")}`;
        out.push({ kind: "address", request: r, since, detail: what + also([!r.resolved.product && "the product", qtyMissing && "the quantity"]) });
      } else if (!r.resolved.product) {
        const what = unmatched.length ? `${unmatched.map((l) => `“${l.asked}”`).join(", ")} not in the catalogue` : "No product in the email";
        out.push({ kind: "product", request: r, since, detail: what + also([qtyMissing && "the quantity"]) });
      } else if (qtyMissing) {
        out.push({ kind: "qty", request: r, since, detail: "No quantity given" });
      }
      continue;
    }
    const answeredSince = edits.answered && askedAt && edits.answered.at > askedAt;
    if (askedAt && !answeredSince && now - new Date(askedAt).getTime() > STALE_AFTER_MS)
      out.push({ kind: "stale", request: r, since: askedAt, detail: "Asked over a day ago with no answer; chase the customer" });
  }
  return out.sort((a, b) => EXCEPTION_ORDER.indexOf(a.kind) - EXCEPTION_ORDER.indexOf(b.kind) || a.since.localeCompare(b.since));
}
