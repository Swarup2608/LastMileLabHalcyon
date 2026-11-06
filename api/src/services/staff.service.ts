import type { SessionRepository } from "../repositories/session.repository.js";
import { toStaffDto, type StaffRepository } from "../repositories/staff.repository.js";
import type { CreateStaffBody, UpdateStaffBody } from "../schemas/staff.schema.js";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../utils/http-error.js";
import { generatePassword, hashPassword } from "../utils/password.js";

// Anyone can sign in as a demo account from the sign-in page, so a demo admin can't add admin rights to any account
// (SEC-01). Everything else an admin does stays open to it.
const DEMO_ADMIN_REFUSED = "Demo accounts can't create or promote admins";
export const DEMO_MODE_OFF = "Demo accounts are turned off on this server (DEMO_MODE=false)";

export class StaffService {
  constructor(
    private readonly staff: StaffRepository,
    private readonly sessions: SessionRepository,
    private readonly demoMode = true,
  ) {}

  async list() {
    return (await this.staff.list()).map(toStaffDto);
  }

  async get(id: string) {
    const row = await this.staff.findById(id);
    if (!row) throw notFound();
    return toStaffDto(row);
  }

  // The starting password is generated here and returned only in this response; just its hash is stored.
  async create({ email, name, role }: CreateStaffBody, actorIsDemo = false) {
    if (role === "admin" && actorIsDemo) throw forbidden(DEMO_ADMIN_REFUSED);
    const temporaryPassword = generatePassword();
    try {
      const row = await this.staff.insert({ email, name, role, passwordHash: await hashPassword(temporaryPassword) });
      return { staff: toStaffDto(row), temporaryPassword };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A staff member with this email already exists");
      throw err;
    }
  }

  // Role, deactivation and password changes end the member's sessions.
  async update(id: string, { name, role, isActive, password }: UpdateStaffBody, actorId: string, actorIsDemo = false) {
    if (role === "admin" && actorIsDemo) throw forbidden(DEMO_ADMIN_REFUSED);
    // Keeps an admin from locking themselves out.
    if (id === actorId && (role === "contributor" || isActive === false)) {
      throw badRequest("you can't demote or deactivate your own account");
    }

    if (password !== undefined && (await this.staff.findById(id))?.is_demo) {
      throw badRequest("turn off demo for this account before setting its password");
    }
    const row = await this.staff.update(id, {
      name,
      role,
      isActive,
      passwordHash: password ? await hashPassword(password) : undefined,
    });
    if (!row) throw notFound();
    if (role !== undefined || isActive === false || password !== undefined) await this.sessions.revokeAllFor("staff", id);
    return toStaffDto(row);
  }

  // Demo on: a fresh generated password, shown on the sign-in page. Demo off: another fresh password, returned once
  // for the admin to hand over, so the one that was public stops working. Both end the member's sessions.
  async setDemo(id: string, isDemo: boolean, actorId: string) {
    if (isDemo && !this.demoMode) throw conflict(DEMO_MODE_OFF);
    if (id === actorId) throw badRequest("you can't make your own account a demo account");
    const password = generatePassword();
    const row = await this.staff.setDemo(id, {
      isDemo,
      demoPassword: isDemo ? password : null,
      passwordHash: await hashPassword(password),
    });
    if (!row) throw notFound();
    await this.sessions.revokeAllFor("staff", id);
    return { staff: toStaffDto(row), ...(isDemo ? {} : { temporaryPassword: password }) };
  }
}
