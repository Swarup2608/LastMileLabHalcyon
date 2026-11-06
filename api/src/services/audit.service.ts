import type { Request } from "express";
import { toAuditDto, type AuditActor, type AuditEntry, type AuditRepository } from "../repositories/audit.repository.js";
import type { AuditListQuery } from "../schemas/audit.schema.js";
import type { Principal } from "../types/auth.js";

export const actorOf = (principal: Pick<Principal, "type" | "id" | "role">): AuditActor => ({
  type: principal.type,
  id: principal.id,
  role: principal.role,
});

type RequestEntry = Omit<AuditEntry, "actor" | "outcome" | "ip" | "userAgent"> & {
  // Defaults to the signed-in user (req.auth); null records an anonymous actor.
  actor?: AuditActor | null;
  outcome?: AuditEntry["outcome"];
};

export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  // Records an action taken in this request. Best effort: the action itself has already happened, so a failed audit
  // write is logged loudly rather than turned into an error for the user.
  async record(req: Request, { actor, outcome = "success", ...entry }: RequestEntry) {
    const fromRequest = req.auth ? { type: req.auth.typ, id: req.auth.sub, role: req.auth.role } : null;
    // Tells the access.denied hook this request is already in the log.
    if (req.res) req.res.locals.audited = true;
    try {
      await this.audit.record({
        ...entry,
        actor: actor === undefined ? fromRequest : actor,
        outcome,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
    } catch (err) {
      console.error(`audit write failed for ${entry.action}`, err);
    }
  }

  async list(query: AuditListQuery) {
    const { rows, total } = await this.audit.list(query);
    return { entries: rows.map(toAuditDto), total, limit: query.limit, offset: query.offset };
  }
}
