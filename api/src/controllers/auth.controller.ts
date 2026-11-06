import type { Request, Response } from "express";
import type { LoginBody, UpdateAccountBody } from "../schemas/auth.schema.js";
import { actorOf, type AuditService } from "../services/audit.service.js";
import type { AuthResult, AuthService } from "../services/auth.service.js";
import type { PrincipalType } from "../types/auth.js";
import { readCookie, REFRESH_COOKIE, type CookieService } from "../utils/cookies.js";
import { HttpError } from "../utils/http-error.js";

const sessionContext = (req: Request) => ({ userAgent: req.get("user-agent"), ip: req.ip });

// One controller per realm ("client" or "staff"), so each realm's routes only accept that realm's tokens.
export class AuthController {
  constructor(
    private readonly realm: PrincipalType,
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
    private readonly audit: AuditService,
  ) {}

  // Tokens go out only as httpOnly cookies; the body carries the user and when the access token expires.
  private send(res: Response, result: AuthResult) {
    this.cookies.setAuth(res, result.accessToken, result.refreshToken);
    res.set("Cache-Control", "no-store");
    res.json({ user: result.user, accessTokenExpiresAt: result.accessTokenExpiresAt });
  }

  // A failed sign-in is recorded with the email tried (never the password) and no actor.
  login = async (req: Request<Record<string, string>, unknown, LoginBody>, res: Response) => {
    const { email, password } = req.body;
    let result: AuthResult;
    try {
      result = await this.auth.login(this.realm, email, password, sessionContext(req));
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        await this.audit.record(req, { actor: null, action: "auth.login", outcome: "failure", details: { realm: this.realm, email } });
      }
      throw err;
    }
    await this.audit.record(req, { actor: actorOf(result.user), action: "auth.login", details: { realm: this.realm } });
    this.send(res, result);
  };

  refresh = async (req: Request, res: Response) => {
    try {
      this.send(res, await this.auth.refresh(this.realm, readCookie(req, REFRESH_COOKIE), sessionContext(req)));
    } catch (err) {
      // A failed refresh means the session is over; drop the dead cookies along with the 401.
      this.cookies.clearAuth(res);
      throw err;
    }
  };

  // Always succeeds and clears both cookies, even when the session is already gone.
  logout = async (req: Request, res: Response) => {
    const ended = await this.auth.logout(readCookie(req, REFRESH_COOKIE));
    if (ended) await this.audit.record(req, { actor: { type: ended.typ, id: ended.sub }, action: "auth.logout" });
    this.cookies.clearAuth(res);
    res.status(204).end();
  };

  // Signs the user out on every device.
  logoutAll = async (req: Request, res: Response) => {
    await this.auth.logoutAll(req.auth!.typ, req.auth!.sub);
    await this.audit.record(req, { action: "auth.logout_all" });
    this.cookies.clearAuth(res);
    res.status(204).end();
  };

  // A new email or password comes back with a fresh session, whose cookies replace the ones just revoked. Logged
  // with which fields changed (and the new email), never a password.
  updateAccount = async (req: Request<Record<string, string>, unknown, UpdateAccountBody>, res: Response) => {
    const { name, email, newPassword } = req.body;
    const details = {
      changed: [name !== undefined && "name", email !== undefined && "email", newPassword !== undefined && "password"].filter(Boolean),
      ...(email !== undefined ? { email } : {}),
    };
    const target = { targetType: req.auth!.typ === "staff" ? "staff" : "client_user", targetId: req.auth!.sub } as const;
    let result: Awaited<ReturnType<AuthService["updateAccount"]>>;
    try {
      result = await this.auth.updateAccount(this.realm, req.auth!.typ, req.auth!.sub, req.body, sessionContext(req));
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        await this.audit.record(req, { action: "account.update", outcome: "failure", ...target, details: { ...details, reason: err.message } });
      }
      throw err;
    }
    await this.audit.record(req, { action: "account.update", ...target, details });
    if (result.session) return this.send(res, result.session);
    res.set("Cache-Control", "no-store");
    res.json({ user: result.user });
  };

  me = async (req: Request, res: Response) => {
    const user = await this.auth.me(this.realm, req.auth!.typ, req.auth!.sub);
    res.set("Cache-Control", "no-store");
    res.json({ user });
  };
}

// GET /api/auth/demo-accounts, public: the demo logins the sign-in page offers as one-click buttons.
export class DemoAccountsController {
  constructor(private readonly auth: AuthService) {}

  list = async (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.json({ accounts: await this.auth.demoAccounts() });
  };
}
