import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PrincipalType, Role } from "../types/auth.js";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.logout_all"
  | "auth.refresh_reuse"
  | "account.update"
  | "staff.list"
  | "staff.view"
  | "staff.create"
  | "staff.update"
  | "staff.demo"
  | "client.list"
  | "client.view"
  | "client.signup"
  | "client_user.list"
  | "client_user.create"
  | "client_user.update"
  | "client_user.demo"
  | "audit.list"
  | "email.list"
  | "email.analyze"
  | "email.request.update"
  | "email.ignore"
  | "email.restore"
  | "email.request.answer"
  | "email.view"
  | "email.request.stock_draft"
  | "email.request.stock_response"
  | "order.api.create"
  | "marketplace.order"
  | "order.email.send"
  | "settings.delivery.update"
  | "carrier_plan.run"
  | "carrier_plan.choose"
  | "carrier_plan.assign"
  | "rebalance.suggest"
  | "rebalance.apply"
  | "db.migrate"
  | "db.tables"
  | "db.table_view"
  | "db.seed_clients"
  | "access.denied";

export type AuditTargetType = "staff" | "client" | "client_user" | "email" | "order_request" | "settings" | "carrier_plan" | "products";

export interface AuditActor {
  type: PrincipalType;
  id: string;
  role?: Role;
}

export interface AuditEntry {
  actor: AuditActor | null;
  action: AuditAction;
  outcome: "success" | "failure";
  targetType?: AuditTargetType;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export interface AuditRow {
  audit_id: string;
  occurred_at: Date;
  actor_type: PrincipalType | null;
  actor_id: string | null;
  actor_role: Role | null;
  action: AuditAction;
  outcome: "success" | "failure";
  target_type: AuditTargetType | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
}

export const toAuditDto = (row: AuditRow) => ({
  id: row.audit_id,
  occurredAt: row.occurred_at,
  actor: row.actor_type && row.actor_id ? { type: row.actor_type, id: row.actor_id, role: row.actor_role } : null,
  action: row.action,
  outcome: row.outcome,
  target: row.target_type ? { type: row.target_type, id: row.target_id } : null,
  details: row.details,
  ip: row.ip,
  userAgent: row.user_agent,
});

export interface AuditFilters {
  actorId?: string;
  action?: string;
  targetId?: string;
  outcome?: "success" | "failure";
  limit: number;
  offset: number;
}

const COLUMNS = `audit_id, occurred_at, actor_type, actor_id, actor_role, action, outcome, target_type, target_id, details,
  ip, user_agent`;

const WHERE = `WHERE ($1::uuid IS NULL OR actor_id = $1)
                 AND ($2::text IS NULL OR action = $2)
                 AND ($3::text IS NULL OR target_id = $3)
                 AND ($4::text IS NULL OR outcome = $4)`;

// Append-only: there is deliberately no update, and the only delete is retention (purgeOlderThan).
export class AuditRepository {
  constructor(private readonly db: Pool) {}

  async record(entry: AuditEntry) {
    await this.db.query(
      `INSERT INTO audit_log (audit_id, actor_type, actor_id, actor_role, action, outcome, target_type, target_id, details,
                              ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        entry.actor?.type ?? null,
        entry.actor?.id ?? null,
        entry.actor?.role ?? null,
        entry.action,
        entry.outcome,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ip ?? null,
        entry.userAgent?.slice(0, 512) ?? null,
      ],
    );
  }

  async purgeOlderThan(before: Date) {
    const { rowCount } = await this.db.query(`DELETE FROM audit_log WHERE occurred_at < $1`, [before]);
    return rowCount ?? 0;
  }

  // Newest first.
  async list({ actorId, action, targetId, outcome, limit, offset }: AuditFilters) {
    const params = [actorId ?? null, action ?? null, targetId ?? null, outcome ?? null];
    const [page, count] = await Promise.all([
      this.db.query<AuditRow>(`SELECT ${COLUMNS} FROM audit_log ${WHERE} ORDER BY occurred_at DESC LIMIT $5 OFFSET $6`, [
        ...params,
        limit,
        offset,
      ]),
      this.db.query<{ total: string }>(`SELECT count(*) AS total FROM audit_log ${WHERE}`, params),
    ]);
    return { rows: page.rows, total: Number(count.rows[0].total) };
  }
}
