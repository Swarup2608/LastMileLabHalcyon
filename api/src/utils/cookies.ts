import type { CookieOptions, Request, Response } from "express";
import type { Config } from "../config/env.js";

export const ACCESS_COOKIE = "halcyon_at";
export const REFRESH_COOKIE = "halcyon_rt";

// The refresh token is only ever sent to the auth routes, never to the rest of the API.
const REFRESH_PATH = "/api/auth";

export const readCookie = (req: Request, name: string): string | undefined => {
  const value: unknown = req.cookies?.[name];
  return typeof value === "string" && value ? value : undefined;
};

// Both tokens live in httpOnly cookies so page scripts can never read them.
export class CookieService {
  constructor(private readonly config: Config) {}

  private base(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      domain: this.config.cookieDomain,
    };
  }

  setAuth(res: Response, accessToken: string, refreshToken: string) {
    res.cookie(ACCESS_COOKIE, accessToken, { ...this.base(), path: "/", maxAge: this.config.accessTokenTtl * 1000 });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.base(),
      path: REFRESH_PATH,
      maxAge: this.config.refreshTokenTtl * 1000,
    });
  }

  clearAuth(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { ...this.base(), path: "/" });
    res.clearCookie(REFRESH_COOKIE, { ...this.base(), path: REFRESH_PATH });
  }
}
