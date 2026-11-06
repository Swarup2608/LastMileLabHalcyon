import type { RequestHandler } from "express";
import type { SessionRepository } from "../repositories/session.repository.js";
import { ACCESS_COOKIE, readCookie } from "../utils/cookies.js";
import type { TokenService } from "../utils/jwt.js";

// Reads the access-token cookie and sets req.auth when it is valid and its session is still live. The role and client
// come from the database, not the token, so revocation, deactivation and role changes apply on the next request.
// Never rejects on its own; route guards (requireAuth / requireRole) decide what an anonymous request may do.
export const authenticate =
  (tokens: TokenService, sessions: SessionRepository): RequestHandler =>
  async (req, _res, next) => {
    const token = readCookie(req, ACCESS_COOKIE);
    if (token) {
      const claims = await tokens.verifyAccess(token);
      const live = claims && (await sessions.findLiveAccess(claims.sid, claims.typ, claims.sub));
      if (claims && live) req.auth = { ...claims, role: live.role, clientId: live.clientId, isDemo: live.isDemo ?? false };
    }
    next();
  };
