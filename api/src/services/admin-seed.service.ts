import { z } from "zod";
import type { StaffRepository } from "../repositories/staff.repository.js";
import { emailSchema, nameSchema, passwordSchema } from "../schemas/common.schema.js";
import { hashPassword } from "../utils/password.js";

const adminSchema = z.object({ email: emailSchema, password: passwordSchema, name: nameSchema });

export type AdminSeed = z.input<typeof adminSchema>;

// Makes `email` an active admin with `password`: creates the account, or promotes and resets an existing one (which
// takes it off the demo list, since its published password stops working). Run once by `npm run admin:create` for the
// first admin; that admin adds everyone else, and marks demo accounts, from Users. Returns the staff id so the caller
// can end the account's existing sessions.
export async function seedAdmin(staff: StaffRepository, admin: AdminSeed): Promise<string> {
  const parsed = adminSchema.safeParse(admin);
  if (!parsed.success) {
    throw new Error(`Invalid admin details: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const { email, password, name } = parsed.data;
  return staff.upsertAdmin({ email, name, passwordHash: await hashPassword(password) });
}
