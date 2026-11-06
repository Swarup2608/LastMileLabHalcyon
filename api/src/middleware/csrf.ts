import type { RequestHandler } from "express";
import { forbidden } from "../utils/http-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF guard for cookie auth: browsers always send Origin on cross-site writes, so a write from an origin outside
// CORS_ORIGINS is refused. Requests without Origin (curl, server-to-server) carry no victim's cookies.
export const verifyOrigin =
  (allowed: string[]): RequestHandler =>
  (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin && !allowed.includes(origin)) throw forbidden("Origin not allowed");
    next();
  };
