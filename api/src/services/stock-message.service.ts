import type { EmailAgent } from "../utils/foundry.js";

// What staff know when a warehouse turns out to be out of stock for an order.
export interface StockMessageInput {
  customer: string;
  ref: string;
  // "Compact lamp ×10", one per item that's short.
  items: string[];
  warehouse: string;
  // "YYYY-MM-DD": the date the order was due, and the one proposed instead.
  originalDate: string;
  newDate: string;
  // Anything staff want the message to mention.
  reason?: string;
}

export interface StockMessage {
  message: string;
  // "ai" when the draft agent wrote it; "template" when no agent is configured or it failed.
  source: "ai" | "template";
}

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

// The agent's reply as plain text: its text, or the message field of a JSON reply.
function textOf(output: unknown): string | null {
  if (typeof output === "string") return output.trim() || null;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    const text = ["message", "draft", "body", "email", "text"].map((k) => o[k]).find((v) => typeof v === "string" && v.trim());
    return typeof text === "string" ? text.trim() : null;
  }
  return null;
}

// Drafts the message telling a customer their order is short at its warehouse and proposing a new delivery date. The
// draft agent (FOUNDRY_DRAFT_AGENT_NAME) writes it when configured, from the order details sent here and the
// email-writing rules in its Foundry instructions; otherwise, or when it fails, a fixed template does. Staff review and
// edit it before it reaches the customer either way.
export class StockMessageService {
  // Undefined when no draft agent is configured.
  constructor(private readonly agent?: EmailAgent) {}

  async draft(input: StockMessageInput): Promise<StockMessage> {
    if (this.agent) {
      try {
        // Only the order's details: how to write the email is in the agent's own instructions in Foundry.
        const reply = await this.agent.ask(
          [
            `Customer: ${input.customer}`,
            `Order: ${input.ref}`,
            `Out of stock: ${input.items.join("; ")}`,
            `Warehouse: ${input.warehouse}`,
            `Original delivery date: ${longDate(input.originalDate)}`,
            `Proposed new delivery date: ${longDate(input.newDate)}`,
            input.reason ? `Staff note: ${input.reason}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        const text = textOf(reply.output);
        if (text) return { message: text, source: "ai" };
      } catch (err) {
        console.error(`stock message draft failed for ${input.ref}`, err);
      }
    }
    return { message: this.template(input), source: "template" };
  }

  private template({ customer, ref, items, warehouse, originalDate, newDate, reason }: StockMessageInput) {
    const first = customer.split(/\s+/)[0] || "there";
    return [
      `Hi ${first},`,
      "",
      `We're sorry: ${items.join(", ")} on your order ${ref} ${items.length === 1 ? "is" : "are"} out of stock at our ${warehouse} warehouse, so it can't arrive on ${longDate(originalDate)} as planned.`,
      reason ? `\n${reason}\n` : "",
      `We can deliver it on ${longDate(newDate)} instead. Please accept the new date on your order in the Halcyon portal, or reply to let us know if it doesn't work for you.`,
      "",
      "Best,",
      "Halcyon Orders",
    ]
      .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
      .join("\n");
  }
}
