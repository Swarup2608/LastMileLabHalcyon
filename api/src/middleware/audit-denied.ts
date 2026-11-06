import type { RequestHandler } from "express";
import type { AuditService } from "../services/audit.service.js";

// Records every refused (403) request by a signed-in user, e.g. a contributor calling an admin route, unless the
// handler already logged it under its own action.
export const auditDenied =
  (audit: AuditService): RequestHandler =>
  (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode !== 403 || !req.auth || res.locals.audited) return;
      void audit.record(req, {
        action: "access.denied",
        outcome: "failure",
        details: { method: req.method, path: req.originalUrl.split("?")[0] },
      });
    });
    next();
  };
