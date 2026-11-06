import type { Pool } from "pg";

// A carrier's latest monthly figures (carrier_performance_latest, db/init/09_carrier_performance.sql).
export interface CarrierStatsRow {
  carrier_id: string;
  carrier_name: string | null;
  preferred: boolean;
  period_month: Date;
  midwest_late_pct: string | null;
  northeast_late_pct: string | null;
  southeast_late_pct: string | null;
  west_late_pct: string | null;
  avg_rate_usd: string | null;
}

export interface CarrierPlanRow {
  plan_date: string;
  input: unknown;
  report: string | null;
  agent: string | null;
  run_by: string | null;
  created_at: Date;
}

// carrier_plans (db/init/10_carrier_plans.sql) and the carrier figures the plans are made from.
export class CarrierPlanRepository {
  constructor(private readonly db: Pool) {}

  async carrierStats() {
    const { rows } = await this.db.query<CarrierStatsRow>(
      `SELECT carrier_id, carrier_name, preferred, period_month, midwest_late_pct, northeast_late_pct, southeast_late_pct,
              west_late_pct, avg_rate_usd
       FROM carrier_performance_latest ORDER BY carrier_id`,
    );
    return rows;
  }

  // Recomputes this month's carrier figures unless they're already in; true when it did. In place of pg_cron, which
  // Azure doesn't allow.
  async refreshMonthIfMissing() {
    const { rows } = await this.db.query<{ has: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM carrier_performance WHERE period_month = date_trunc('month', now())::date) AS has`,
    );
    if (rows[0]?.has) return false;
    await this.db.query(`SELECT refresh_carrier_performance()`);
    return true;
  }

  async get(date: string) {
    // plan_date is the date asked for; read back, pg would turn it into a Date at local midnight.
    const { rows } = await this.db.query<Omit<CarrierPlanRow, "plan_date">>(
      `SELECT input, report, agent, run_by, created_at FROM carrier_plans WHERE plan_date = $1::date`,
      [date],
    );
    return rows[0] ? { ...rows[0], plan_date: date } : null;
  }

  async save(plan: { date: string; input: unknown; report: string | null; agent: string | null; runBy: string | null }) {
    await this.db.query(
      `INSERT INTO carrier_plans (plan_date, input, report, agent, run_by, created_at)
       VALUES ($1::date, $2::jsonb, $3, $4, $5::uuid, now())
       ON CONFLICT (plan_date) DO UPDATE SET input = EXCLUDED.input, report = EXCLUDED.report, agent = EXCLUDED.agent,
         run_by = EXCLUDED.run_by, created_at = now()`,
      [plan.date, JSON.stringify(plan.input), plan.report, plan.agent, plan.runBy],
    );
  }

  // Replaces the plan's input only: the agent's report and who ran it stay as they are.
  async saveInput(date: string, input: unknown) {
    await this.db.query(`UPDATE carrier_plans SET input = $2::jsonb WHERE plan_date = $1::date`, [date, JSON.stringify(input)]);
  }
}
