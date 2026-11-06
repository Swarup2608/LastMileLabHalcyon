-- Carrier performance per month: each carrier's late-delivery rate into each region and its average shipping price,
-- from deliveries. The carrier agent ranks carriers on the latest month. A month's row covers every delivery received
-- before that month starts, so the row for October 2026 is everything up to the end of September:
--
--   Carrier  Midwest  Northeast  Southeast  West  Avg rate
--   A        25%      24%        25%        26%   $16.69
--   B        25%      26%        24%        23%   $16.07
--   C        24%      24%        26%        26%   $17.80
--   D        47%      34%        46%        33%   $13.53
--   E        25%      23%        26%        46%   $14.23
--   F        25%      44%        47%        24%   $12.52   (preferred supplier)
--
-- refresh_carrier_performance() recomputes a month (the current one by default) and is re-run on the 1st of each
-- month: by pg_cron where the server has it, otherwise by hand or by any scheduler with
-- `psql "$DATABASE_URL" -c "SELECT refresh_carrier_performance()"`. Idempotent, so it runs on first container start
-- and can be re-applied with `psql "$DATABASE_URL" -f 09_carrier_performance.sql`.

CREATE TABLE IF NOT EXISTS carrier_performance (
  -- First day of the month the figures are for.
  period_month       DATE NOT NULL,
  carrier_id         TEXT NOT NULL REFERENCES carriers(carrier_id),
  -- Percent of deliveries into the region that arrived late; NULL when the carrier made none there.
  midwest_late_pct   NUMERIC(5,2),
  northeast_late_pct NUMERIC(5,2),
  southeast_late_pct NUMERIC(5,2),
  west_late_pct      NUMERIC(5,2),
  avg_rate_usd       NUMERIC(10,2),
  deliveries         INT NOT NULL,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_month, carrier_id)
);

-- Recomputes one month's rows from deliveries received before it; returns how many carriers were written.
CREATE OR REPLACE FUNCTION refresh_carrier_performance(p_month DATE DEFAULT date_trunc('month', now())::date)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_count INT;
BEGIN
  INSERT INTO carrier_performance AS cp
    (period_month, carrier_id, midwest_late_pct, northeast_late_pct, southeast_late_pct, west_late_pct, avg_rate_usd, deliveries)
  SELECT v_month,
         d.carrier_id,
         ROUND(100.0 * COUNT(*) FILTER (WHERE d.destination_region = 'Midwest'   AND d.on_time <> 'Y')
                     / NULLIF(COUNT(*) FILTER (WHERE d.destination_region = 'Midwest'), 0), 2),
         ROUND(100.0 * COUNT(*) FILTER (WHERE d.destination_region = 'Northeast' AND d.on_time <> 'Y')
                     / NULLIF(COUNT(*) FILTER (WHERE d.destination_region = 'Northeast'), 0), 2),
         ROUND(100.0 * COUNT(*) FILTER (WHERE d.destination_region = 'Southeast' AND d.on_time <> 'Y')
                     / NULLIF(COUNT(*) FILTER (WHERE d.destination_region = 'Southeast'), 0), 2),
         ROUND(100.0 * COUNT(*) FILTER (WHERE d.destination_region = 'West'      AND d.on_time <> 'Y')
                     / NULLIF(COUNT(*) FILTER (WHERE d.destination_region = 'West'), 0), 2),
         ROUND(AVG(d.carrier_rate_usd), 2),
         COUNT(*)
  FROM deliveries d
  WHERE d.carrier_id IS NOT NULL
    AND d.order_received_ts < v_month
  GROUP BY d.carrier_id
  ON CONFLICT (period_month, carrier_id) DO UPDATE SET
    midwest_late_pct   = EXCLUDED.midwest_late_pct,
    northeast_late_pct = EXCLUDED.northeast_late_pct,
    southeast_late_pct = EXCLUDED.southeast_late_pct,
    west_late_pct      = EXCLUDED.west_late_pct,
    avg_rate_usd       = EXCLUDED.avg_rate_usd,
    deliveries         = EXCLUDED.deliveries,
    computed_at        = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Each carrier's most recent month, with its name and whether it holds the preferred-supplier agreement: what the
-- carrier agent is given.
CREATE OR REPLACE VIEW carrier_performance_latest AS
SELECT DISTINCT ON (cp.carrier_id)
       cp.period_month,
       cp.carrier_id,
       c.carrier_name,
       (c.preferred_supplier_agreement = 'Y') AS preferred,
       cp.midwest_late_pct,
       cp.northeast_late_pct,
       cp.southeast_late_pct,
       cp.west_late_pct,
       cp.avg_rate_usd,
       cp.deliveries
FROM carrier_performance cp
JOIN carriers c ON c.carrier_id = cp.carrier_id
ORDER BY cp.carrier_id, cp.period_month DESC;

-- This month's figures now.
SELECT refresh_carrier_performance();

-- Monthly refresh at 02:00 UTC on the 1st, where pg_cron is installed (Azure Database for PostgreSQL has it once it's
-- allow-listed and preloaded; the stock postgres image doesn't). Without it this only logs a notice.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('carrier-performance-monthly', '0 2 1 * *', 'SELECT refresh_carrier_performance()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available (%); run SELECT refresh_carrier_performance() monthly yourself', SQLERRM;
END;
$$;
