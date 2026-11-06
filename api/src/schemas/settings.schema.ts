import { z } from "zod";
import { isTimeZone } from "../utils/delivery.js";

// The same-day cutoff an admin sets: orders received before it deliver the same day, the rest the next day.
export const deliveryRuleSchema = {
  body: z
    .object({
      sameDayCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "cutoff must be a 24-hour time like 08:00"),
      timeZone: z.string().trim().min(1).max(64).refine(isTimeZone, "unknown time zone"),
    })
    .strict(),
};

export type DeliveryRuleBody = z.infer<typeof deliveryRuleSchema.body>;
