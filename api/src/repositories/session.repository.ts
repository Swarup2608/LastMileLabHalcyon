import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PrincipalType, Role } from "../types/auth.js";

// Two tabs refreshing at once both present the same token; the loser of that race shouldn't be treated as theft.
const REUSE_GRACE_MS = 10_000;

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export type RotateResult =
  | { status: "rotated"; sessionId: string; familyId: string; principalType: PrincipalType; principalId: string }
  | { status: "invalid" }
  | { status: "reused" };

// The live state behind an access token: the principal's current role (and client), read fresh on every request.
export interface LiveAccess {
  role: Role;
  clientId?: string;
  // Staff only: the account is a demo account, so its password is public on the sign-in page.
  isDemo?: boolean;
}

export class SessionRepository {
  constructor(
    private readonly db: Pool,
    private readonly ttlSeconds: number,
    private readonly reuseGraceMs = REUSE_GRACE_MS,
  ) {}

  private expiry() {
    return new Date(Date.now() + this.ttlSeconds * 1000);
  }

  async create(principalType: PrincipalType, principalId: string, ctx: SessionContext, familyId = randomUUID()) {
    const sessionId = randomUUID();
    await this.db.query(
      `INSERT INTO auth_sessions (session_id, family_id, principal_type, principal_id, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, familyId, principalType, principalId, this.expiry(), ctx.userAgent?.slice(0, 512) ?? null, ctx.ip ?? null],
    );
    return { sessionId, familyId };
  }

  // Single-use refresh: the UPDATE claims the row atomically, so only one request can rotate a given token.
  async rotate(sessionId: string, principalType: PrincipalType, principalId: string, ctx: SessionContext): Promise<RotateResult> {
    const nextId = randomUUID();
    const claimed = await this.db.query<{ family_id: string }>(
      `UPDATE auth_sessions SET revoked_at = now(), replaced_by = $2
       WHERE session_id = $1 AND principal_type = $3 AND principal_id = $4
         AND revoked_at IS NULL AND expires_at > now()
       RETURNING family_id`,
      [sessionId, nextId, principalType, principalId],
    );

    if (claimed.rowCount === 1) {
      const familyId = claimed.rows[0].family_id;
      await this.db.query(
        `INSERT INTO auth_sessions (session_id, family_id, principal_type, principal_id, expires_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [nextId, familyId, principalType, principalId, this.expiry(), ctx.userAgent?.slice(0, 512) ?? null, ctx.ip ?? null],
      );
      return { status: "rotated", sessionId: nextId, familyId, principalType, principalId };
    }

    const existing = await this.db.query<{ family_id: string; revoked_at: Date | null; replaced_by: string | null }>(
      `SELECT family_id, revoked_at, replaced_by FROM auth_sessions WHERE session_id = $1`,
      [sessionId],
    );
    const row = existing.rows[0];
    if (!row?.revoked_at) return { status: "invalid" };
    if (row.replaced_by && Date.now() - new Date(row.revoked_at).getTime() < this.reuseGraceMs) return { status: "invalid" };

    // A rotated or logged-out token came back: assume it was stolen and end every session descended from it.
    await this.revokeFamily(row.family_id);
    return { status: "reused" };
  }

  async revoke(sessionId: string) {
    await this.db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL`, [sessionId]);
  }

  async revokeFamily(familyId: string) {
    await this.db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [familyId]);
  }

  // An access token is honoured only while its session family still has a live refresh session and its principal is
  // still active, so logout, logout-all, deactivation, role and password changes (which all revoke sessions) cut off
  // access on the next request rather than when the token expires. Rotation keeps the family alive.
  async findLiveAccess(familyId: string, principalType: PrincipalType, principalId: string): Promise<LiveAccess | null> {
    const live = `a.family_id = $1 AND a.principal_type = $2 AND a.principal_id = $3
                  AND a.revoked_at IS NULL AND a.expires_at > now()`;
    if (principalType === "staff") {
      const { rows } = await this.db.query<{ role: Role; is_demo: boolean }>(
        `SELECT s.role, s.is_demo FROM auth_sessions a JOIN staff s ON s.staff_id = a.principal_id
         WHERE ${live} AND s.is_active LIMIT 1`,
        [familyId, principalType, principalId],
      );
      return rows[0] ? { role: rows[0].role, isDemo: rows[0].is_demo } : null;
    }
    const { rows } = await this.db.query<{ client_id: string }>(
      `SELECT u.client_id FROM auth_sessions a JOIN client_users u ON u.client_user_id = a.principal_id
       WHERE ${live} AND u.is_active LIMIT 1`,
      [familyId, principalType, principalId],
    );
    return rows[0] ? { role: "client", clientId: rows[0].client_id } : null;
  }

  // Deletes rows that expired before the cutoff. Only expiry counts, never revocation: a revoked row has to stay while
  // its refresh token could still be presented, so a replay is caught as theft, and no token outlives expires_at.
  async purgeExpired(before: Date) {
    const { rowCount } = await this.db.query(`DELETE FROM auth_sessions WHERE expires_at < $1`, [before]);
    return rowCount ?? 0;
  }

  async revokeAllFor(principalType: PrincipalType, principalId: string) {
    await this.db.query(
      `UPDATE auth_sessions SET revoked_at = now()
       WHERE principal_type = $1 AND principal_id = $2 AND revoked_at IS NULL`,
      [principalType, principalId],
    );
  }
}
