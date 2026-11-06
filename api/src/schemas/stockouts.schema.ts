import { z } from "zod";

// How far back to list stock-outs at the nearest warehouse.
export const listStockoutsSchema = {
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).strict(),
};

export type ListStockoutsQuery = z.infer<typeof listStockoutsSchema.query>;
