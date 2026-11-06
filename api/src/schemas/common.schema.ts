import { z } from "zod";

// Trimmed and lowercased before the format check, so "  Ana@Example.COM " is stored as ana@example.com.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("a valid email is required").max(254));

export const nameSchema = z.string().trim().min(1, "name is required").max(120, "name must be at most 120 characters");

export const passwordSchema = z
  .string()
  .min(10, "password must be at least 10 characters")
  .max(256, "password must be at most 256 characters")
  .regex(/[a-zA-Z]/, "password must contain a letter")
  .regex(/[0-9]/, "password must contain a number");

export const uuidSchema = z.uuid();

export const clientIdSchema = z.string().trim().min(1).max(32);

// Marks a login as a demo account (listed with its password on the sign-in page) or back to a normal one.
export const demoBodySchema = z.object({ isDemo: z.boolean() }).strict();
