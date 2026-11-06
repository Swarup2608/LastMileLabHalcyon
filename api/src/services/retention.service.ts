import type { AuditRepository } from "../repositories/audit.repository.js";
import type { SessionRepository } from "../repositories/session.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// How often the clean-up runs while the API is up. Every instance runs it; a second delete of the same rows is a no-op.
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface RetentionPolicy {
  sessionRetentionDays: number;
  // 0 keeps audit rows forever.
  auditRetentionDays: number;
}

// Deletes session rows SESSION_RETENTION_DAYS after they expire and audit rows older than AUDIT_RETENTION_DAYS.
export class RetentionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly audit: AuditRepository,
    private readonly policy: RetentionPolicy,
  ) {}

  async run(now = Date.now()) {
    const sessions = await this.sessions.purgeExpired(new Date(now - this.policy.sessionRetentionDays * DAY_MS));
    const audit = this.policy.auditRetentionDays
      ? await this.audit.purgeOlderThan(new Date(now - this.policy.auditRetentionDays * DAY_MS))
      : 0;
    return { sessions, audit };
  }

  // Runs now and then every RETENTION_INTERVAL_MS; returns a stop function. Failures are logged and retried next time.
  schedule(intervalMs = RETENTION_INTERVAL_MS) {
    const tick = () =>
      this.run().then(
        ({ sessions, audit }) => {
          if (sessions || audit) console.log(`retention: deleted ${sessions} expired sessions, ${audit} audit rows`);
        },
        (err) => console.error("retention clean-up failed", err),
      );
    void tick();
    const timer = setInterval(tick, intervalMs);
    // Never keeps the process alive on its own.
    timer.unref();
    return () => clearInterval(timer);
  }
}
