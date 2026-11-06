import { z } from "zod";
import { clientIdSchema } from "./common.schema.js";
import { MAX_ORDER_QUANTITY, TOO_MANY_CARTONS } from "../utils/agent-json.js";
import { addressProblem } from "../utils/request-address.js";

export const listEmailsSchema = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

export type EmailListQuery = z.infer<typeof listEmailsSchema.query>;

// Gmail message ids are hex strings.
export const getEmailSchema = {
  params: z.object({ messageId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
};

export type EmailParams = z.infer<typeof getEmailSchema.params>;

// A line's cartons, on staff's edit (lines) or the routing decision (routed.lines): false when any is over the limit.
const quantitiesInLimit = (edits: Record<string, unknown>) => {
  const typed = Object.values((edits.lines ?? {}) as Record<string, { quantity?: unknown }>);
  const routed = ((edits.routed as { lines?: unknown } | undefined)?.lines ?? []) as { quantity?: unknown }[];
  return [...typed, ...(Array.isArray(routed) ? routed : [])].every((l) => !(Number(l?.quantity) > MAX_ORDER_QUANTITY));
};

// Staff's work on a request, as the web app keeps it (RequestEdits). Its shape belongs to the web app, so only the
// client link and line quantities are checked here; the rest is stored as given, within a size limit.
export const saveRequestSchema = {
  params: getEmailSchema.params,
  body: z.object({
    edits: z
      .record(z.string(), z.unknown())
      .refine((edits) => JSON.stringify(edits).length <= 20_000, "edits are too large")
      .refine(quantitiesInLimit, TOO_MANY_CARTONS),
    // Routes a request whose address is still incomplete (FR-04), and is audited.
    override: z.boolean().optional(),
    // Omitted: the client is the one the email matches. null: deliberately unlinked.
    clientId: clientIdSchema.nullable().optional(),
    // When the request first became ready to route; stored once (see EmailRepository.saveRequest).
    intakeAt: z.iso.datetime({ offset: true }).optional(),
  }),
};

export type SaveRequestBody = z.infer<typeof saveRequestSchema.body>;

// Staff ignoring an email (out of the queue) or restoring one.
export const ignoreSchema = {
  params: getEmailSchema.params,
  body: z.object({ ignore: z.boolean() }).strict(),
};

export type IgnoreBody = z.infer<typeof ignoreSchema.body>;

const answerText = (max: number) => z.string().trim().max(max).optional();

// A client's answers to what staff asked, from the portal's order page. Only what was asked can be answered: the
// shipping address, a quantity or product per line (keys are the web app's line keys), and a note.
export const answerRequestSchema = {
  params: getEmailSchema.params,
  body: z
    .object({
      address: z
        .object({
          street: answerText(200),
          suite: answerText(100),
          city: answerText(100),
          region: answerText(100),
          postal: answerText(20),
          country: answerText(100),
        })
        .strict()
        // An answer can be partial, so a field left out is treated as blank, which addressProblem skips.
        .superRefine((a, ctx) => {
          const problem = addressProblem(a.region ?? "", a.postal ?? "", a.country ?? "");
          if (problem) ctx.addIssue({ code: "custom", message: problem.message, path: [problem.field] });
        })
        .optional(),
      lines: z
        .record(
          z.string().regex(/^\d{1,3}$/),
          z
            .object({
              quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY, TOO_MANY_CARTONS).optional(),
              productId: z.string().trim().min(1).max(32).optional(),
              // What they meant, in their words, when the product isn't in their catalogue.
              note: answerText(500),
            })
            .strict(),
        )
        .optional(),
      note: answerText(1000),
    })
    .strict(),
};

export type AnswerRequestBody = z.infer<typeof answerRequestSchema.body>;

const required = (max: number, label: string) => z.string().trim().min(1, `${label} is required`).max(max);

// An order placed through the API (POST /api/order-requests) by a client user: products from the client's own
// catalogue by id or SKU, and a full shipping address. It arrives complete, so it routes like a resolved email request.
export const createOrderSchema = {
  body: z
    .object({
      // The client's own order number (PO), shown with the order.
      reference: answerText(64),
      // Who it's for, when not the client user placing it.
      customer: answerText(120),
      lines: z
        .array(
          z
            .object({
              productId: z.string().trim().min(1).max(32).optional(),
              sku: z.string().trim().min(1).max(32).optional(),
              quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY, TOO_MANY_CARTONS),
            })
            .strict()
            .refine((l) => l.productId || l.sku, "each line needs a productId or a sku"),
        )
        .min(1, "an order needs at least one line")
        .max(50),
      address: z
        .object({
          street: required(200, "street"),
          suite: answerText(100),
          city: required(100, "city"),
          region: required(100, "state"),
          postal: required(20, "postal code"),
          country: answerText(100),
        })
        .strict()
        .superRefine((a, ctx) => {
          const problem = addressProblem(a.region, a.postal, a.country ?? "");
          if (problem) ctx.addIssue({ code: "custom", message: problem.message, path: [problem.field] });
        }),
      notes: answerText(1000),
    })
    .strict(),
};

export type CreateOrderBody = z.infer<typeof createOrderSchema.body>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

// Staff asking for a draft of the out-of-stock message: what's short, where, and the new date they propose.
export const stockDraftSchema = {
  params: getEmailSchema.params,
  body: z
    .object({
      customer: z.string().trim().min(1).max(120),
      ref: z.string().trim().min(1).max(32),
      items: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
      warehouse: z.string().trim().min(1).max(120),
      originalDate: isoDate,
      newDate: isoDate,
      reason: answerText(500),
    })
    .strict()
    .refine((b) => b.newDate > b.originalDate, { message: "the new date must be after the original one", path: ["newDate"] }),
};

export type StockDraftBody = z.infer<typeof stockDraftSchema.body>;

// The client's answer to a proposed new delivery date.
export const stockResponseSchema = {
  params: getEmailSchema.params,
  body: z.object({ decision: z.enum(["accept", "decline"]), note: answerText(500) }).strict(),
};

export type StockResponseBody = z.infer<typeof stockResponseSchema.body>;
