import { z } from "zod";
import { emailSchema, nameSchema, passwordSchema } from "./common.schema.js";

// Login doesn't apply the password strength rules: they belong to setting a password, not to checking one.
export const loginSchema = {
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, "password is required").max(256),
  }),
};

// Your own account: the name changes freely; the sign-in details (email, password) need the current password.
export const updateAccountSchema = {
  body: z
    .object({
      name: nameSchema.optional(),
      email: emailSchema.optional(),
      newPassword: passwordSchema.optional(),
      currentPassword: z.string().min(1, "currentPassword is required").max(256).optional(),
    })
    .strict()
    .refine(
      (body) => body.name !== undefined || body.email !== undefined || body.newPassword !== undefined,
      "nothing to update",
    )
    .refine((body) => (body.email === undefined && body.newPassword === undefined) || body.currentPassword, {
      message: "currentPassword is required to change the email or password",
      path: ["currentPassword"],
    }),
};

export type LoginBody = z.infer<typeof loginSchema.body>;
export type UpdateAccountBody = z.infer<typeof updateAccountSchema.body>;
