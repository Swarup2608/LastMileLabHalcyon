-- Tops every client's catalogue up to at least 6 products, with stock, so each client has something to order. Synthetic,
-- like 03_products.sql and 04_warehouse_products.sql, which only gave 50 products to random clients. Runs on first
-- container start (after 04_warehouse_products.sql) and can be re-applied with
-- `psql "$DATABASE_URL" -f 07_client_products.sql`: it only adds products to clients that have fewer than 6, so a
-- second run changes nothing.
--
-- A client's new products all have different names (the noun steps through the list), and their SKUs have five digits,
-- so they never clash with the four-digit SKUs from 03_products.sql.

BEGIN;

WITH short AS (
  SELECT c.client_id,
         -- int, since array subscripts must be.
         (row_number() OVER (ORDER BY c.client_id))::int AS seq,
         count(p.product_id)::int AS has
  FROM clients AS c
  LEFT JOIN products AS p ON p.client_id = c.client_id
  GROUP BY c.client_id
  HAVING count(p.product_id) < 6
),
slots AS (
  -- idx runs from the client's next product to its 6th.
  SELECT s.client_id, s.seq, idx
  FROM short AS s
  CROSS JOIN LATERAL generate_series(s.has + 1, 6) AS idx
),
numbered AS (
  SELECT sl.*,
         (SELECT coalesce(max(substring(product_id FROM 2)::int), 0) FROM products)
           + row_number() OVER (ORDER BY sl.client_id, sl.idx) AS n
  FROM slots AS sl
)
INSERT INTO products (product_id, sku, product_name, category, client_id, unit_price_usd, unit_weight_kg)
SELECT
  'P' || lpad(n::text, 4, '0'),
  upper(left(c.category, 2)) || '-' || lpad(n::text, 5, '0'),
  c.adjective || ' ' || c.noun,
  c.category,
  r.client_id,
  round((5 + random() * 495)::numeric, 2),
  round((0.1 + random() * 24.9)::numeric, 2)
FROM numbered AS r
CROSS JOIN LATERAL (
  SELECT
    (ARRAY['Hardware', 'Medical', 'Outdoor', 'Kitchen', 'Office', 'Automotive', 'Garden', 'Pet', 'Lab', 'Home'])[1 + (r.seq + r.idx) % 10] AS category,
    (ARRAY['Heavy duty', 'Compact', 'Premium', 'Standard', 'Bulk', 'Industrial', 'Lightweight', 'Deluxe'])[1 + (r.seq * 3 + r.idx) % 8] AS adjective,
    (ARRAY['storage bin', 'tool kit', 'cable set', 'filter pack', 'glove box', 'cleaning kit', 'mount bracket', 'carry case',
           'shelf unit', 'tape roll', 'spray bottle', 'lamp', 'fastener pack', 'cover set', 'tray set'])[1 + (r.seq * 7 + r.idx) % 15] AS noun
) AS c;

-- Stock for every product that has none yet (the ones just added): 1-3 random warehouses each, as in
-- 04_warehouse_products.sql, with 50-500 cartons on hand and up to 30% of them reserved.
INSERT INTO warehouse_products (warehouse_id, product_id, quantity_on_hand, quantity_reserved, reorder_point, bin_location)
SELECT
  w.warehouse_id,
  p.product_id,
  s.on_hand,
  floor(random() * s.on_hand * 0.3)::int,
  20 + floor(random() * 80)::int,
  chr(65 + floor(random() * 6)::int) || '-' || lpad((1 + floor(random() * 40))::int::text, 2, '0')
    || '-' || (1 + floor(random() * 5))::int
FROM products AS p
CROSS JOIN LATERAL (
  -- Referencing p makes the subquery run per product, so each one gets its own warehouses.
  SELECT warehouse_id FROM warehouses WHERE p.product_id IS NOT NULL
  ORDER BY random() LIMIT 1 + floor(random() * 3)::int
) AS w
CROSS JOIN LATERAL (SELECT 50 + floor(random() * 451)::int AS on_hand) AS s
WHERE NOT EXISTS (SELECT 1 FROM warehouse_products AS wp WHERE wp.product_id = p.product_id);

COMMIT;
