"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConsoleUser } from "@/components/console/ConsoleShell";
import { orderRequestsApi, type InboundEmail } from "@/lib/emails";
import { ASK_KEYS, buildRequest, questionsFor, useStock, type AskKey, type OrderRequest } from "@/lib/order-request";
import { deliveryDay } from "@/lib/settings";
import type { Warehouse } from "@/lib/warehouses";

// What staff want the client to answer: the questions marked on Resolve that are still open, else what the last email
// asked. Marking is enough; the client sees them without any email being sent.
export function questionsOf(r: OrderRequest): AskKey[] {
  const edits = r.email.edits ?? {};
  if (r.status === "routed") return [];
  const marked = ASK_KEYS.filter((k) => edits.ask?.[k] && !r.resolved[k]);
  return marked.length ? marked : r.status === "asked" ? (edits.asked?.keys ?? []).filter((k) => !r.resolved[k]) : [];
}

// Waiting on the client: questions to answer, or a new delivery date to accept or decline.
export const needsClient = (r: OrderRequest) => questionsOf(r).length > 0 || r.email.edits?.stockFlag?.status === "pending";

// What the client is told about each status: plainer than staff's, and about what happens next.
export type Tone = "ok" | "warn" | "info" | "neutral";

export function clientStatus(r: OrderRequest, warehouseName: (id: string) => string): { tone: Tone; label: string } {
  const edits = r.email.edits ?? {};
  if (edits.stockFlag?.status === "pending") return { tone: "warn", label: "New delivery date to confirm" };
  if (r.status === "routed" && edits.routed) return { tone: "ok", label: `Shipping from ${edits.routed.warehouseIds.map(warehouseName).join(" and ")}` };
  if (questionsOf(r).length) return { tone: "warn", label: "Needs your input" };
  if (edits.answered) return { tone: "info", label: "Answered, being checked" };
  if (r.status === "ready") return { tone: "info", label: "Being scheduled" };
  if (r.status === "agent") return { tone: "neutral", label: "Received" };
  return { tone: "info", label: "Being reviewed" };
}

export const itemsOf = (r: OrderRequest) =>
  r.lines
    .filter((l) => !l.declined)
    .map((l) => `${l.product?.productName ?? l.asked}${l.quantity ? ` ×${l.quantity}` : ""}`)
    .join(", ");
export const shipToOf = (r: OrderRequest) =>
  [r.address.street, r.address.suite, r.address.city, r.address.region, r.address.postal].filter(Boolean).join(", ");
export const orderPath = (r: OrderRequest) => `/portal/orders/${encodeURIComponent(r.ref)}`;

// The signed-in client's emailed order requests, matched to their own catalogue (so an item from another client's
// catalogue shows as written in the email). Refreshes every 30 seconds; reload() after answering.
export function useClientRequests(enabled = true) {
  const [emails, setEmails] = useState<InboundEmail[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const { stock, failed: stockFailed } = useStock();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () =>
      orderRequestsApi.mine().then(
        (r) => {
          if (!active) return;
          setEmails(r.emails);
          setFailed(false);
        },
        () => active && setFailed(true),
      );
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [enabled, tick]);

  const requests = useMemo(
    () => (emails && stock ? emails.map((e) => buildRequest(e, stock.products, e.edits ?? {})) : null),
    [emails, stock],
  );
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { requests, stock, failed: failed || stockFailed, reload };
}

// One message Halcyon has sent the client about an order. kind: "warn" needs their action, "ok" is good news.
export interface ClientMessage {
  at: string;
  text: string;
  kind: "" | "ok" | "warn";
}

// What Halcyon has told the client about an emailed order, oldest first: received, the questions still open (from when
// staff marked them; no email needed), their answers, and where it ships from.
export function messagesOf(r: OrderRequest, warehouseName: (id: string) => string): ClientMessage[] {
  const edits = r.email.edits ?? {};
  const asks = questionsOf(r);
  const out: ClientMessage[] = [{ at: r.email.receivedAt, text: r.email.channel === "api" ? `We received your API order ${r.ref}.` : `We received your emailed order “${r.email.subject || "Order"}”.`, kind: "" }];
  if (asks.length)
    out.push({
      at: edits.askAt ?? edits.asked?.at ?? r.email.receivedAt,
      text: `We need a few details before this order can ship: ${questionsFor(r, asks).join(" ")} Open the order to answer.`,
      kind: "warn",
    });
  if (edits.answered) out.push({ at: edits.answered.at, text: "Thanks for your answers. We’re checking them and will route the order.", kind: "" });
  if (edits.routed)
    out.push({ at: edits.routed.at, text: `Your order ships from ${edits.routed.warehouseIds.map(warehouseName).join(" and ")}.`, kind: "ok" });
  const flag = edits.stockFlag;
  if (flag) {
    out.push({
      at: flag.at,
      text: `${flag.items.join(", ")} ${flag.items.length === 1 ? "is" : "are"} out of stock. We propose delivering on ${deliveryDay(flag.newDate)} instead. Open the order to accept or decline.`,
      kind: "warn",
    });
    if (flag.respondedAt)
      out.push({
        at: flag.respondedAt,
        text: flag.status === "accepted" ? `Thanks, your order now delivers on ${deliveryDay(flag.newDate)}.` : "You declined the new date; our team will be in touch.",
        kind: flag.status === "accepted" ? "ok" : "",
      });
  }
  return out;
}

export const warehouseNameIn = (stock: { warehouses: Warehouse[] }) => (id: string) =>
  stock.warehouses.find((w) => w.warehouseId === id)?.warehouseName ?? id;

// Client: counts their orders waiting on them (questions to answer, a new date to accept) for the header bell. Real data
// only. Mounted once by the shell; renders nothing.
export function ClientAttentionFeed({ onCount }: { onCount: (n: number) => void }) {
  const user = useConsoleUser();
  const { requests } = useClientRequests(user.role === "client");

  useEffect(() => {
    if (requests) onCount(requests.filter(needsClient).length);
  }, [requests, onCount]);

  return null;
}
