// Creates the first admin in the database at DATABASE_URL, or gets an admin back in after a lockout.
//   npm run admin:create -- <email> ["Full Name"]        from api/ in development
//   node dist/db/create-admin.js <email> ["Full Name"]   on a deployed API (after npm run build)
// The email becomes an active admin with a freshly generated password, printed once here and never stored readable.
// An existing account with that email is promoted, taken off the demo list and signed out everywhere. Everyone else
// is added from Users in the portal.
import "dotenv/config";
import { Pool } from "pg";
import { SessionRepository } from "../repositories/session.repository.js";
import { StaffRepository } from "../repositories/staff.repository.js";
import { seedAdmin } from "../services/admin-seed.service.js";
import { generatePassword } from "../utils/password.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const [email, name = "Halcyon Admin"] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run admin:create -- <email> ["Full Name"]');
  process.exit(1);
}

const db = new Pool({ connectionString: url });
try {
  const password = generatePassword();
  const id = await seedAdmin(new StaffRepository(db), { email, name, password });
  // The token lifetime only matters when creating sessions; this just ends them.
  await new SessionRepository(db, 0).revokeAllFor("staff", id);
  console.log(`Admin ready: ${email}`);
  console.log(`Password:    ${password}`);
  console.log("Shown once. Sign in with the Halcyon staff toggle, then change it from Account settings.");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
