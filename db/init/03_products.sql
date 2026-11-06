-- Halcyon product catalogue. The supplied dataset has no products CSV, so 50 synthetic products are generated, each
-- owned by one of the clients. Idempotent, so it runs on first container start and can be re-applied with
-- `psql "$DATABASE_URL" -f 03_products.sql`; products are only generated while the table is empty.

CREATE TABLE IF NOT EXISTS products (
  product_id     TEXT PRIMARY KEY,
  sku            TEXT NOT NULL UNIQUE,
  product_name   TEXT NOT NULL,
  category       TEXT NOT NULL,
  client_id      TEXT NOT NULL REFERENCES clients(client_id),
  unit_price_usd NUMERIC(10, 2) NOT NULL CHECK (unit_price_usd > 0),
  unit_weight_kg NUMERIC(8, 2) NOT NULL CHECK (unit_weight_kg > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_client_id_idx ON products (client_id);

INSERT INTO products (product_id, sku, product_name, category, client_id, unit_price_usd, unit_weight_kg)
SELECT
  'P' || lpad(n::text, 4, '0'),
  upper(left(c.category, 2)) || '-' || lpad((1000 + n * 37 % 9000)::text, 4, '0'),
  c.adjective || ' ' || c.noun,
  c.category,
  -- Referencing n makes the subquery run per row, so each product gets its own random client.
  (SELECT client_id FROM clients WHERE n > 0 ORDER BY random() LIMIT 1),
  round((5 + random() * 495)::numeric, 2),
  round((0.1 + random() * 24.9)::numeric, 2)
FROM generate_series(1, 50) AS n
CROSS JOIN LATERAL (
  SELECT
    (ARRAY['Hardware', 'Medical', 'Outdoor', 'Kitchen', 'Office', 'Automotive', 'Garden', 'Pet', 'Lab', 'Home'])[1 + (n - 1) % 10] AS category,
    (ARRAY['Heavy duty', 'Compact', 'Premium', 'Standard', 'Bulk', 'Industrial', 'Lightweight', 'Deluxe'])[1 + floor(random() * 8)::int] AS adjective,
    (ARRAY['storage bin', 'tool kit', 'cable set', 'filter pack', 'glove box', 'cleaning kit', 'mount bracket', 'carry case',
           'shelf unit', 'tape roll', 'spray bottle', 'lamp', 'fastener pack', 'cover set', 'tray set'])[1 + floor(random() * 15)::int] AS noun
) AS c
WHERE NOT EXISTS (SELECT 1 FROM products);
