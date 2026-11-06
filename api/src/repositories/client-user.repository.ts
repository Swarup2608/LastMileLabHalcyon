import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/transaction.js";
import type { Principal } from "../types/auth.js";

export interface ClientUserRow {
  client_user_id: string;
  client_id: string;
  email: string;
  full_name: string;
  password_hash: string;
  is_active: boolean;
  is_demo: boolean;
  demo_password: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

// A client user joined with their company, as needed to build the signed-in principal.
export interface ClientUserWithClientRow extends ClientUserRow {
  client_name: string | null;
  region: string | null;
  account_tier: string | null;
  account_status: string | null;
}

export const toClientUserDto = (row: ClientUserRow) => ({
  id: row.client_user_id,
  clientId: row.client_id,
  email: row.email,
  name: row.full_name,
  isActive: row.is_active,
  isDemo: row.is_demo,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

export const toClientPrincipal = (row: ClientUserWithClientRow): Principal => ({
  type: "client",
  id: row.client_user_id,
  email: row.email,
  name: row.full_name,
  role: "client",
  isDemo: row.is_demo,
  client: {
    clientId: row.client_id,
    clientName: row.client_name,
    region: row.region,
    accountTier: row.account_tier,
    accountStatus: row.account_status,
  },
});

const COLUMNS = `client_user_id, client_id, email, full_name, password_hash, is_active, is_demo, demo_password,
  last_login_at, created_at`;
const WITH_CLIENT = `
  SELECT u.client_user_id, u.client_id, u.email, u.full_name, u.password_hash, u.is_active, u.is_demo,
         u.demo_password, u.last_login_at, u.created_at, c.client_name, c.region, c.account_tier, c.account_status
  FROM client_users u JOIN clients c ON c.client_id = u.client_id`;

export interface ClientUserChanges {
  name?: string;
  isActive?: boolean;
  passwordHash?: string;
}

// Emails are stored lowercased; callers pass them already normalised.
export class ClientUserRepository {
  constructor(private readonly db: Queryable) {}

  async findByEmail(email: string) {
    const { rows } = await this.db.query<ClientUserWithClientRow>(`${WITH_CLIENT} WHERE u.email = $1`, [email]);
    return rows[0] ?? null;
  }

  async findActiveById(id: string) {
    const { rows } = await this.db.query<ClientUserWithClientRow>(
      `${WITH_CLIENT} WHERE u.client_user_id = $1 AND u.is_active`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByClient(clientId: string) {
    const { rows } = await this.db.query<ClientUserRow>(
      `SELECT ${COLUMNS} FROM client_users WHERE client_id = $1 ORDER BY created_at`,
      [clientId],
    );
    return rows;
  }

  async insert(input: { clientId: string; email: string; name: string; passwordHash: string }) {
    const { rows } = await this.db.query<ClientUserRow>(
      `INSERT INTO client_users (client_user_id, client_id, email, full_name, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [randomUUID(), input.clientId, input.email, input.name, input.passwordHash],
    );
    return rows[0];
  }

  async update(clientId: string, id: string, changes: ClientUserChanges) {
    const { rows } = await this.db.query<ClientUserRow>(
      `UPDATE client_users SET
         full_name     = COALESCE($3, full_name),
         is_active     = COALESCE($4, is_active),
         password_hash = COALESCE($5, password_hash),
         updated_at    = now()
       WHERE client_user_id = $1 AND client_id = $2 RETURNING ${COLUMNS}`,
      [id, clientId, changes.name ?? null, changes.isActive ?? null, changes.passwordHash ?? null],
    );
    return rows[0] ?? null;
  }

  // The user's own name and sign-in details, changed from their account page.
  async updateAccount(id: string, changes: { name?: string; email?: string; passwordHash?: string }) {
    const { rows } = await this.db.query<ClientUserRow>(
      `UPDATE client_users SET
         full_name     = COALESCE($2, full_name),
         email         = COALESCE($3, email),
         password_hash = COALESCE($4, password_hash),
         updated_at    = now()
       WHERE client_user_id = $1 RETURNING ${COLUMNS}`,
      [id, changes.name ?? null, changes.email ?? null, changes.passwordHash ?? null],
    );
    return rows[0] ?? null;
  }

  // Turning demo on stores the generated password readable (for the sign-in page); turning it off clears it. The
  // password itself is replaced either way.
  async setDemo(
    clientId: string,
    id: string,
    demo: { isDemo: boolean; demoPassword: string | null; passwordHash: string },
  ) {
    const { rows } = await this.db.query<ClientUserRow>(
      `UPDATE client_users SET is_demo = $3, demo_password = $4, password_hash = $5, updated_at = now()
       WHERE client_user_id = $1 AND client_id = $2 RETURNING ${COLUMNS}`,
      [id, clientId, demo.isDemo, demo.demoPassword, demo.passwordHash],
    );
    return rows[0] ?? null;
  }

  async listDemo() {
    const { rows } = await this.db.query<ClientUserWithClientRow>(
      `${WITH_CLIENT} WHERE u.is_demo AND u.is_active AND u.demo_password IS NOT NULL ORDER BY c.client_id, u.full_name`,
    );
    return rows;
  }

  async touchLogin(id: string) {
    await this.db.query(`UPDATE client_users SET last_login_at = now() WHERE client_user_id = $1`, [id]);
  }
}
