import { z } from "zod";

// The products to rebalance; left out, every product stocked somewhere (Rebalance all).
export const suggestRebalanceSchema = {
  body: z
    .object({
      productIds: z.array(z.string().trim().min(1).max(64)).min(1).max(1000).optional(),
    })
    .strict(),
};

export type SuggestRebalanceBody = z.infer<typeof suggestRebalanceSchema.body>;

const warehouseId = z.string().trim().min(1).max(16);

// The transfers staff apply from the rebalance popup, as they edited them.
export const applyRebalanceSchema = {
  body: z
    .object({
      transfers: z
        .array(
          z
            .object({
              productId: z.string().trim().min(1).max(64),
              source: warehouseId,
              destination: warehouseId,
              quantity: z.number().int().min(1).max(10_000),
              origin: z.enum(["suggested", "edited"]),
              reason: z.string().trim().max(500).optional(),
            })
            .strict()
            .refine((t) => t.source !== t.destination, "source and destination must differ"),
        )
        .min(1)
        .max(200),
    })
    .strict(),
};

export type ApplyRebalanceBody = z.infer<typeof applyRebalanceSchema.body>;

export const listTransfersSchema = {
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).strict(),
};

export type ListTransfersQuery = z.infer<typeof listTransfersSchema.query>;
