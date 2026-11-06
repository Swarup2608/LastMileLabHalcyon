import type { Config } from "../config/env.js";
import type { AuditRepository } from "../repositories/audit.repository.js";
import { toClientPrincipal, type ClientUserRepository } from "../repositories/client-user.repository.js";
import type { SessionContext, SessionRepository } from "../repositories/session.repository.js";
import { toStaffPrincipal, type StaffRepository } from "../repositories/staff.repository.js";
import type { UpdateAccountBody } from "../schemas/auth.schema.js";
import type { Principal, PrincipalType, Role } from "../types/auth.js";
import { conflict, forbidden, isUniqueViolation, unauthorized } from "../utils/http-error.js";
import type { TokenService } from "../utils/jwt.js";
import { hashPassword, needsRehash, verifyPassword } from "../utils/password.js";

export interface AuthResult {
  user: Principal;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export interface DemoAccount {
  realm: PrincipalType;
  name: string;
  email: string;
  password: string;
  role: Role;
  clientName: string | null;
}

const BAD_CREDENTIALS = "Email or password is incorrect";
const SESSION_EXPIRED = "Session expired. Sign in again.";

export class AuthService {
  constructor(
    private readonly config: Config,
    private readonly staff: StaffRepository,
    private readonly clientUsers: ClientUserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditRepository,
  ) {}

  // Unknown email, wrong password and inactive account all produce the same error so the response doesn't
  // reveal which accounts exist.
  async login(type: PrincipalType, email: string, password: string, ctx: SessionContext): Promise<AuthResult> {
    const row = type === "staff" ? await this.staff.findByEmail(email) : await this.clientUsers.findByEmail(email);
    if (!(await verifyPassword(password, row?.password_hash)) || !row?.is_active) throw unauthorized(BAD_CREDENTIALS);
    if (row.is_demo && !this.config.demoMode) throw unauthorized(BAD_CREDENTIALS);

    const principal = "staff_id" in row ? toStaffPrincipal(row) : toClientPrincipal(row);
    const accounts = type === "staff" ? this.staff : this.clientUsers;
    await accounts.touchLogin(principal.id);
    // The one moment the plain password is at hand: upgrade an old scrypt (or weaker argon2) hash to today's argon2id.
    if (needsRehash(row.password_hash)) await accounts.updateAccount(principal.id, { passwordHash: await hashPassword(password) });

    return this.issue(principal, await this.sessions.create(type, principal.id, ctx));
  }

  // Rotates the refresh token: the presented one is spent and a new pair is issued.
  async refresh(type: PrincipalType, refreshToken: string | undefined, ctx: SessionContext): Promise<AuthResult> {
    const claims = refreshToken ? await this.tokens.verifyRefresh(refreshToken) : null;
    if (!claims || claims.typ !== type) throw unauthorized(SESSION_EXPIRED);

    const principal = await this.activePrincipal(type, claims.sub);
    if (!principal || (principal.isDemo && !this.config.demoMode)) {
      await this.sessions.revokeAllFor(type, claims.sub);
      throw unauthorized(SESSION_EXPIRED);
    }
    const result = await this.sessions.rotate(claims.jti, type, claims.sub, ctx);
    if (result.status === "reused") {
      // A spent refresh token came back: likely stolen. The family is already revoked; leave a trail.
      await this.audit
        .record({
          actor: { type, id: claims.sub, role: principal.role },
          action: "auth.refresh_reuse",
          outcome: "failure",
          details: { sessionId: claims.jti },
          ...ctx,
        })
        .catch((err) => console.error("audit write failed for auth.refresh_reuse", err));
    }
    if (result.status !== "rotated") throw unauthorized(SESSION_EXPIRED);
    return this.issue(principal, result);
  }

  // Ends the session behind this refresh token, if any, and says whose it was. Never fails.
  async logout(refreshToken: string | undefined) {
    const claims = refreshToken ? await this.tokens.verifyRefresh(refreshToken) : null;
    if (claims) await this.sessions.revoke(claims.jti);
    return claims;
  }

  async logoutAll(type: PrincipalType, id: string) {
    await this.sessions.revokeAllFor(type, id);
  }

  // The signed-in user, looked up fresh so a deactivated account stops working on its next /me.
  async me(realm: PrincipalType, type: PrincipalType, id: string): Promise<Principal> {
    if (realm !== type) throw forbidden();
    const principal = await this.activePrincipal(type, id);
    if (!principal) throw unauthorized();
    return principal;
  }

  // The signed-in user updates their own account. The name changes freely; a new email or password needs the current
  // password. Either one changes the sign-in details, so it ends every session (other devices included) and starts a
  // fresh one here, returned as `session`: someone holding a stolen session can't quietly keep it after a takeover.
  async updateAccount(
    realm: PrincipalType,
    type: PrincipalType,
    id: string,
    { name, email, newPassword, currentPassword }: UpdateAccountBody,
    ctx: SessionContext,
  ): Promise<{ user: Principal; session?: AuthResult }> {
    if (realm !== type) throw forbidden();
    const row = type === "staff" ? await this.staff.findActiveById(id) : await this.clientUsers.findActiveById(id);
    if (!row) throw unauthorized();
    if (row.is_demo) throw forbidden("Demo accounts can't be changed");
    // The schema already requires currentPassword with email/newPassword. A wrong one is a 403 rather than 401, so the
    // web client doesn't take it for an expired session; the login limiter counts it like a failed login.
    if (email !== undefined || newPassword !== undefined) {
      if (!currentPassword || !(await verifyPassword(currentPassword, row.password_hash))) {
        throw forbidden("Current password is incorrect");
      }
    }

    const changes = { name, email, passwordHash: newPassword ? await hashPassword(newPassword) : undefined };
    try {
      if (type === "staff") await this.staff.updateAccount(id, changes);
      else await this.clientUsers.updateAccount(id, changes);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("This email is already in use");
      throw err;
    }

    const principal = await this.activePrincipal(type, id);
    if (!principal) throw unauthorized();
    if (email === undefined && newPassword === undefined) return { user: principal };

    await this.sessions.revokeAllFor(type, id);
    const session = await this.issue(principal, await this.sessions.create(type, id, ctx));
    return { user: principal, session };
  }

  // Active demo accounts with their passwords, for the one-click buttons on the sign-in page. Public by design:
  // only accounts an admin explicitly marked as demo are listed.
  async demoAccounts(): Promise<DemoAccount[]> {
    if (!this.config.demoMode) return [];
    const [staff, clientUsers] = await Promise.all([this.staff.listDemo(), this.clientUsers.listDemo()]);
    return [
      ...staff.map((row) => ({
        realm: "staff" as const,
        name: row.full_name,
        email: row.email,
        password: row.demo_password!,
        role: row.role,
        clientName: null,
      })),
      ...clientUsers.map((row) => ({
        realm: "client" as const,
        name: row.full_name,
        email: row.email,
        password: row.demo_password!,
        role: "client" as const,
        clientName: row.client_name,
      })),
    ];
  }

  private async activePrincipal(type: PrincipalType, id: string): Promise<Principal | null> {
    if (type === "staff") {
      const row = await this.staff.findActiveById(id);
      return row ? toStaffPrincipal(row) : null;
    }
    const row = await this.clientUsers.findActiveById(id);
    return row ? toClientPrincipal(row) : null;
  }

  private async issue(principal: Principal, { sessionId, familyId }: { sessionId: string; familyId: string }): Promise<AuthResult> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccess({
        sub: principal.id,
        typ: principal.type,
        role: principal.role,
        clientId: principal.client?.clientId,
        sid: familyId,
      }),
      this.tokens.signRefresh({ sub: principal.id, typ: principal.type, jti: sessionId }),
    ]);
    return {
      user: principal,
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + this.config.accessTokenTtl * 1000).toISOString(),
    };
  }
}
