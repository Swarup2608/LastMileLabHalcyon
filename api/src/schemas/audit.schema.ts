import { z } from "zod";
import { uuidSchema } from "./common.schema.js";

const optionalFilter = z.string().trim().max(100).optional().transform((value) => value || undefined);

export const listAuditSchema = {
  query: z.object({
    actorId: uuidSchema.optional(),
    action: optionalFilter,
    targetId: optionalFilter,
    outcome: z.enum(["success", "failure"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

export type AuditListQuery = z.infer<typeof listAuditSchema.query>;
