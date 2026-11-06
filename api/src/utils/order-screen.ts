// Which incoming orders never need staff: a blank email, the same email sent again, an email with no order in it, and an
// API order placed twice by mistake. Set aside, not deleted: staff see them under Ignored and can restore any.
import { createHash } from "node:crypto";
import { FIELD, fieldOf, jsonOf } from "./agent-json.js";
import { replyProducts } from "./reply-lines.js";

export type IgnoredReason = "blank" | "duplicate" | "not_order" | "staff";

// A repeat counts within this long of the email it repeats; an API order, within minutes (a double submit or retry).
export const DUPLICATE_WINDOW_DAYS = 7;
export const API_DUPLICATE_WINDOW_MINUTES = 10;

// The text that carries the order: lower case, without quoted replies ("> …", "On … wrote:" and below), signatures'
// "-- " and below, or extra spacing.
export function orderText(text: string | null | undefined) {
  const lines: string[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (/^on .+ wrote:$/i.test(t) || t === "--" || /^-{2,}\s*original message/i.test(t)) break;
    if (!t.startsWith(">")) lines.push(t);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

// No letters or digits in the body (or Gmail's snippet, when that's all there is).
export const isBlank = (body: string | null, snippet = "") => !/[\p{L}\p{N}]/u.test(orderText(body ?? snippet));

const address = (from: string) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
const hash = (parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex");

// Same sender, same subject (ignoring Re:/Fwd:) and same order text: the same email.
export const emailFingerprint = (from: string, subject: string, body: string | null, snippet = "") =>
  hash([address(from), subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase(), orderText(body ?? snippet)]);

// Same client, reference, lines (in any order) and address: the same API order.
export const apiOrderFingerprint = (clientId: string, order: { reference?: string | null; lines: unknown[]; address: unknown }) =>
  hash([clientId, (order.reference ?? "").trim().toLowerCase(), JSON.stringify(order.lines.map((l) => JSON.stringify(l)).sort()), JSON.stringify(order.address)]);

// The agent read the email and found nothing to order and nowhere to send it, read the way Resolve reads a reply. A
// reply that isn't JSON says nothing either way, so staff get it.
export function noOrderFound(output: unknown) {
  const reply = typeof output === "string" ? jsonOf(output) : output;
  if (!reply || typeof reply !== "object") return false;
  const where = [/\b(address|street)\b/, FIELD.city, FIELD.state, FIELD.postal].some((f) => fieldOf(reply, f));
  return replyProducts(reply).length === 0 && !where;
}
