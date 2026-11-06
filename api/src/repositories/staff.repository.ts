import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Principal, StaffRole } from "../types/auth.js";

export interface StaffRow {
  staff_id: string;
  email: string;
  full_name: string;
  role: StaffRole;
  password_hash: string;
  is_active: boolean;
  is_demo: boolean;
  demo_password: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

export interface StaffDto {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  isDemo: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export const toStaffDto = (row: StaffRow): StaffDto => ({
  id: row.staff_id,
  email: row.email,
  name: row.full_name,
  role: row.role,
  isActive: row.is_active,
  isDemo: row.is_demo,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

export const toStaffPrincipal = (row: StaffRow): Principal => ({
  type: "staff",
  id: row.staff_id,
  email: row.email,
  name: row.full_name,
  role: row.role,
  isDemo: row.is_demo,
});

const COLUMNS = `staff_id, email, full_name, role, password_hash, is_active, is_demo, demo_password, last_login_at,
  created_at`;

export interface StaffChanges {
  name?: string;
  role?: StaffRole;
  isActive?: boolean;
  passwordHash?: string;
}

// Emails are stored lowercased; callers pass them already normalised.
export class StaffRepository {
  constructor(private readonly db: Pool) {}

  async list() {
    const { rows } = await this.db.query<StaffRow>(`SELECT ${COLUMNS} FROM staff ORDER BY created_at`);
    return rows;
  }

  async findById(id: string) {
    const { rows } = await this.db.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE staff_id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findActiveById(id: string) {
    const { rows } = await this.db.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE staff_id = $1 AND is_active`, [id]);
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const { rows } = await this.db.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE email = $1`, [email]);
    return rows[0] ?? null;
  }

  async insert(input: { email: string; name: string; role: StaffRole; passwordHash: string }) {
    const { rows } = await this.db.query<StaffRow>(
      `INSERT INTO staff (staff_id, email, full_name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [randomUUID(), input.email, input.name, input.role, input.passwordHash],
    );
    return rows[0];
  }

  // Creates the admin or resets an existing account with that email back to an active admin.
  // Sets a new password, so a demo account's published one would stop working: it comes off the demo list too.
  async upsertAdmin(input: { email: string; name: string; passwordHash: string }) {
    const { rows } = await this.db.query<{ staff_id: string }>(
      `INSERT INTO staff (staff_id, email, full_name, role, password_hash)
       VALUES ($1, $2, $3, 'admin', $4)
       ON CONFLICT (email) DO UPDATE SET
         role = 'admin', is_active = true, is_demo = false, demo_password = NULL,
         password_hash = EXCLUDED.password_hash, updated_at = now()
       RETURNING staff_id`,
      [randomUUID(), input.email, input.name, input.passwordHash],
    );
    return rows[0].staff_id;
  }

  async update(id: string, changes: StaffChanges) {
    const { rows } = await this.db.query<StaffRow>(
      `UPDATE staff SET
         full_name     = COALESCE($2, full_name),
         role          = COALESCE($3, role),
         is_active     = COALESCE($4, is_active),
         password_hash = COALESCE($5, password_hash),
         updated_at    = now()
       WHERE staff_id = $1 RETURNING ${COLUMNS}`,
      [id, changes.name ?? null, changes.role ?? null, changes.isActive ?? null, changes.passwordHash ?? null],
    );
    return rows[0] ?? null;
  }

  // The member's own name and sign-in details, changed from their account page.
  async updateAccount(id: string, changes: { name?: string; email?: string; passwordHash?: string }) {
    const { rows } = await this.db.query<StaffRow>(
      `UPDATE staff SET
         full_name     = COALESCE($2, full_name),
         email         = COALESCE($3, email),
         password_hash = COALESCE($4, password_hash),
         updated_at    = now()
       WHERE staff_id = $1 RETURNING ${COLUMNS}`,
      [id, changes.name ?? null, changes.email ?? null, changes.passwordHash ?? null],
    );
    return rows[0] ?? null;
  }

  // Turning demo on stores the generated password readable (for the sign-in page); turning it off clears it. The
  // password itself is replaced either way.
  async setDemo(id: string, demo: { isDemo: boolean; demoPassword: string | null; passwordHash: string }) {
    const { rows } = await this.db.query<StaffRow>(
      `UPDATE staff SET is_demo = $2, demo_password = $3, password_hash = $4, updated_at = now()
       WHERE staff_id = $1 RETURNING ${COLUMNS}`,
      [id, demo.isDemo, demo.demoPassword, demo.passwordHash],
    );
    return rows[0] ?? null;
  }

  async listDemo() {
    const { rows } = await this.db.query<StaffRow>(
      `SELECT ${COLUMNS} FROM staff WHERE is_demo AND is_active AND demo_password IS NOT NULL ORDER BY role, full_name`,
    );
    return rows;
  }

  async touchLogin(id: string) {
    await this.db.query(`UPDATE staff SET last_login_at = now() WHERE staff_id = $1`, [id]);
  }
}
