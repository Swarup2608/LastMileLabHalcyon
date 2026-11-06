-- Settings admins change in the console, one JSON value per key. "delivery" holds the same-day cutoff:
-- { "sameDayCutoff": "08:00", "timeZone": "America/New_York" }; orders received before it deliver the same day, the rest
-- the next day. With no row the API uses those defaults. Idempotent, so it runs on first container start and can be
-- re-applied with `psql "$DATABASE_URL" -f 08_settings.sql`.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
