import { z } from "zod";
import { demoBodySchema, emailSchema, nameSchema, passwordSchema, uuidSchema } from "./common.schema.js";

const roleSchema = z.enum(["admin", "contributor"], "role must be admin or contributor");

const staffParams = z.object({ id: uuidSchema });

export const getStaffSchema = { params: staffParams };

// No password: the API generates the starting one and returns it once, so an admin never picks someone's password.
export const createStaffSchema = {
  body: z
    .object({
      email: emailSchema,
      name: nameSchema,
      role: roleSchema,
    })
    .strict(),
};

export const updateStaffSchema = {
  params: staffParams,
  body: z
    .object({
      name: nameSchema.optional(),
      role: roleSchema.optional(),
      isActive: z.boolean().optional(),
      password: passwordSchema.optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, "nothing to update"),
};

export const staffDemoSchema = { params: staffParams, body: demoBodySchema };

export type StaffParams = z.infer<typeof staffParams>;
export type CreateStaffBody = z.infer<typeof createStaffSchema.body>;
export type UpdateStaffBody = z.infer<typeof updateStaffSchema.body>;
