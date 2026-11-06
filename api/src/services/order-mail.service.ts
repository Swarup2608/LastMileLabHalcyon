import type { OutgoingMail } from "../utils/mailer.js";

export interface OrderMailInput {
  sender: { name: string; email: string };
  reference: string | null;
  customer: string | null;
  lines: { name: string; sku: string; quantity: number }[];
  address: { street: string; suite: string | null; city: string; region: string; postal: string; country: string | null };
  notes: string | null;
}

// The order as a plain email to the order inbox, written the way clients email orders, so the poller and the email
// agent read it like any other. The sender's login address is in the body (and is the Reply-To), which is how intake
// links the request to their client.
export function orderEmail(order: OrderMailInput, to: string): OutgoingMail {
  const cartons = order.lines.reduce((n, l) => n + l.quantity, 0);
  const a = order.address;
  const text = [
    "Hello Halcyon order team,",
    "",
    "Please ship the following order.",
    "",
    ...(order.reference ? [`PO number: ${order.reference}`] : []),
    ...(order.customer ? [`Deliver to: ${order.customer}`] : []),
    ...(order.reference || order.customer ? [""] : []),
    "Products:",
    ...order.lines.map((l) => `- ${l.quantity} x ${l.name} (SKU ${l.sku})`),
    "",
    "Ship to:",
    a.suite ? `${a.street}, ${a.suite}` : a.street,
    `${a.city}, ${a.region} ${a.postal}`,
    ...(a.country ? [a.country] : []),
    ...(order.notes ? ["", `Notes: ${order.notes}`] : []),
    "",
    "Thanks,",
    order.sender.name,
    order.sender.email,
  ].join("\n");
  return {
    to,
    replyTo: `${order.sender.name} <${order.sender.email}>`,
    subject: `New order${order.reference ? ` PO ${order.reference}` : ""} · ${cartons} carton${cartons === 1 ? "" : "s"}`,
    text,
  };
}
