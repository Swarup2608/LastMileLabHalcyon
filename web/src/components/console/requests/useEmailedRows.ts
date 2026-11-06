"use client";

import { useMemo } from "react";
import { useStaffInbox } from "@/lib/inbox";
import { buildRequest, useAllEdits, useStock, type OrderRequest } from "@/lib/order-request";
import type { ExpectedDelivery } from "@/lib/settings";
import { clientStatus, itemsOf, needsClient, orderPath, shipToOf, useClientRequests, type Tone } from "./ClientRequests";

// An emailed order request as a row of the Orders page, for either portal.
export interface EmailedRow {
  id: string;
  channel: "email" | "api";
  // Its page: the client's order page, or Resolve for staff.
  href: string;
  client: string | null;
  items: string;
  shipTo: string;
  status: string;
  tone: Tone;
  // Epoch ms: when it was received, and its intake (accepted as ready to route), null until then.
  arrival: number;
  intake: number | null;
  // Waiting on whoever is looking: the client's answers, or staff.
  attn: boolean;
  routed: boolean;
  warehouse: string | null;
  // The carrier it was assigned to, and whether that delivery is done.
  carrier: string | null;
  delivered: boolean;
  // From the same-day cutoff: received before it, the same day; after, the next day.
  delivery: ExpectedDelivery;
}

// What staff call each status, as on the queue.
function staffStatus(r: OrderRequest): { label: string; tone: Tone } {
  const flag = r.email.edits?.stockFlag;
  if (flag?.status === "pending") return { label: "Out of stock · new date sent", tone: "info" };
  if (flag?.status === "declined") return { label: "New date declined", tone: "warn" };
  if (r.status === "routed") return { label: "Routed", tone: "ok" };
  if (r.status === "ready") return { label: "Ready to route", tone: "ok" };
  if (r.status === "asked") return { label: "Waiting on customer", tone: "info" };
  if (r.status === "agent") return { label: "Agent reading", tone: "neutral" };
  return { label: "Needs information", tone: "warn" };
}

// Staff: the inbox's requests with their saved (or unsaved) edits, kept live by the shared inbox poll.
export function useStaffRequests(enabled: boolean) {
  const { emails } = useStaffInbox(enabled);
  const { stock } = useStock();
  const edits = useAllEdits();
  const requests = useMemo(
    () => (emails && stock ? emails.map((e) => buildRequest(e, stock.products, edits[e.id] ?? e.edits ?? {})) : null),
    [emails, stock, edits],
  );
  return { requests, stock, edits };
}

// The emailed rows for the Orders page: the client's own requests in the client portal, every inbox request for staff.
// null while loading.
export function useEmailedRows(role: "client" | "staff"): EmailedRow[] | null {
  const client = useClientRequests(role === "client");
  const staff = useStaffRequests(role === "staff");
  const { requests, stock } = role === "client" ? client : staff;

  return useMemo(() => {
    if (!requests || !stock) return null;
    const warehouseName = (id: string) => stock.warehouses.find((w) => w.warehouseId === id)?.warehouseName ?? id;
    const clientName = new Map(stock.products.map((p) => [p.clientId, p.clientName ?? p.clientId]));
    return requests.map((r): EmailedRow => {
      const assignment = r.email.carrier;
      const s = assignment
        ? ({ label: assignment.delivered ? "Delivered" : "Out for delivery", tone: assignment.delivered ? "ok" : "info" } as const)
        : role === "client"
          ? clientStatus(r, warehouseName)
          : staffStatus(r);
      const routed = r.email.edits?.routed ?? null;
      return {
        id: r.ref,
        channel: r.email.channel,
        href: role === "client" ? orderPath(r) : `/portal/emails/${encodeURIComponent(r.email.id)}`,
        client: r.clientId ? (clientName.get(r.clientId) ?? r.clientId) : null,
        items: itemsOf(r),
        shipTo: shipToOf(r),
        status: s.label,
        tone: s.tone,
        arrival: new Date(r.email.receivedAt).getTime(),
        intake: r.email.edits?.intakeAt ? new Date(r.email.edits.intakeAt).getTime() : null,
        attn: role === "client" ? needsClient(r) : r.status === "needs" || r.email.edits?.stockFlag?.status === "declined",
        routed: r.status === "routed",
        warehouse: routed ? routed.warehouseIds.map(warehouseName).join(", ") : null,
        carrier: assignment ? `Carrier ${assignment.carrier}` : null,
        delivered: assignment?.delivered ?? false,
        delivery: r.email.expectedDelivery,
      };
    });
  }, [requests, stock, role]);
}
