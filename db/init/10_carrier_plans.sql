-- The carrier plan for each day: once the same-day cutoff has passed, the day's same-day orders and the latest carrier
-- figures (09_carrier_performance.sql) go to the carrier agent (FOUNDRY_CARRIER_AGENT_NAME), and its plain-text report
-- is kept here for contributors and admins. One row per day, replaced when staff run it again. Idempotent, so it runs
-- on first container start and can be re-applied with `psql "$DATABASE_URL" -f 10_carrier_plans.sql`.

CREATE TABLE IF NOT EXISTS carrier_plans (
  -- The day the orders deliver, in the cutoff's time zone.
  plan_date  DATE PRIMARY KEY,
  -- What was sent to the agent: { orders: [...], carriers: [...] }, plus overrides, the carriers staff picked by order id,
  -- which the agent never sees.
  input      JSONB NOT NULL,
  -- The agent's report; NULL when there were no same-day orders, so the agent wasn't asked.
  report     TEXT,
  agent      TEXT,
  -- The staff member who ran it again; NULL when the API ran it at the cutoff.
  run_by     UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
