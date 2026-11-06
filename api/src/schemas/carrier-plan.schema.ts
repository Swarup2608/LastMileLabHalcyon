import { z } from "zod";

// Staff's carrier for one order on today's plan. carrier null: back to the agent's pick.
export const carrierChoiceSchema = {
  body: z
    .object({
      orderId: z.string().trim().min(1).max(64),
      carrier: z.string().trim().min(1).max(64).nullable(),
    })
    .strict(),
};

// override: assigns the agent's carriers even though its plan failed validation; audited.
export const carrierAssignSchema = {
  body: z.object({ override: z.boolean().optional() }).strict(),
};

export type CarrierAssignBody = z.infer<typeof carrierAssignSchema.body>;
export type CarrierChoiceBody = z.infer<typeof carrierChoiceSchema.body>;
