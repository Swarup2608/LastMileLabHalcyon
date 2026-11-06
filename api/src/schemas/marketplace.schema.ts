import { z } from "zod";
import { emailSchema, nameSchema, passwordSchema } from "./common.schema.js";
import { createOrderSchema } from "./emails.schema.js";

const optionalFilter = z.string().trim().max(100).optional().transform((value) => value || undefined);

export const listMarketplaceSchema = {
  query: z.object({
    q: optionalFilter,
    category: optionalFilter,
    limit: z.coerce.number().int().min(1).max(48).default(24),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

// A visitor's first order: the company and login to create, and the order itself. Tier, order channel and contract
// terms aren't here, because they're Halcyon's to set, not the buyer's.
export const marketplaceOrderSchema = {
  body: z
    .object({
      companyName: nameSchema,
      contact: z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }).strict(),
      order: createOrderSchema.body,
    })
    .strict(),
};

export type ListMarketplaceQuery = z.infer<typeof listMarketplaceSchema.query>;
export type MarketplaceOrderBody = z.infer<typeof marketplaceOrderSchema.body>;
