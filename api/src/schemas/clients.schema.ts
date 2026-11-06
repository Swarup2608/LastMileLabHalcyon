import { z } from "zod";
import { clientIdSchema, demoBodySchema, emailSchema, nameSchema, passwordSchema, uuidSchema } from "./common.schema.js";

const optionalFilter = z.string().trim().max(100).optional().transform((value) => value || undefined);

export const listClientsSchema = {
  query: z.object({
    q: optionalFilter,
    region: optionalFilter,
    status: optionalFilter,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const clientParams = z.object({ clientId: clientIdSchema });
const clientUserParams = z.object({ clientId: clientIdSchema, userId: uuidSchema });

export const getClientSchema = { params: clientParams };

export const createClientUserSchema = {
  params: clientParams,
  body: z.object({
    email: emailSchema,
    name: nameSchema,
    password: passwordSchema,
  }),
};

export const updateClientUserSchema = {
  params: clientUserParams,
  body: z
    .object({
      name: nameSchema.optional(),
      isActive: z.boolean().optional(),
      password: passwordSchema.optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, "nothing to update"),
};

export const clientUserDemoSchema = { params: clientUserParams, body: demoBodySchema };

// The values the supplied dataset uses, so new clients filter and group alongside the existing 280.
export const CLIENT_REGIONS = ["Midwest", "Northeast", "Southeast", "West"] as const;
export const ORDER_CHANNELS = ["Email", "EDI", "API"] as const;
export const ACCOUNT_TIERS = ["Tier 1", "Tier 2", "Tier 3"] as const;

// An admin signs up a new client company together with its first login; the contact changes the email and
// password themselves after signing in.
export const signupClientSchema = {
  body: z
    .object({
      clientName: nameSchema,
      region: z.enum(CLIENT_REGIONS, `region must be one of ${CLIENT_REGIONS.join(", ")}`),
      primaryOrderChannel: z.enum(ORDER_CHANNELS, `primaryOrderChannel must be one of ${ORDER_CHANNELS.join(", ")}`),
      accountTier: z.enum(ACCOUNT_TIERS, `accountTier must be one of ${ACCOUNT_TIERS.join(", ")}`),
      slaPenaltyClause: z.boolean().default(false),
      annualRevenueUsd: z.number().nonnegative().max(1e12).nullable().default(null),
      contact: z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }).strict(),
    })
    .strict(),
};

export type ListClientsQuery =z.infer<typeof listClientsSchema.query>;
export type ClientParams = z.infer<typeof clientParams>;
export type ClientUserParams = z.infer<typeof clientUserParams>;
export type CreateClientUserBody = z.infer<typeof createClientUserSchema.body>;
export type UpdateClientUserBody = z.infer<typeof updateClientUserSchema.body>;
export type SignupClientBody = z.infer<typeof signupClientSchema.body>;
