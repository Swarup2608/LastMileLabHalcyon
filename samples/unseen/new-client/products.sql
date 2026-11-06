-- Catalogue and stock for the unseen-input kit's new client, Harbor Point Clinics (West region), created first from
-- signup.json. Three products, each set up to show one routing case for an order to Seattle:
--   HP-0001  stocked in W5 (West), the nearest warehouse
--   HP-0002  stocked only in W4 (Northeast), so the nearest warehouse is short and it ships from far away
--   HP-0003  no stock anywhere
-- Run once against a local or staging database: psql "$DATABASE_URL" -f samples/unseen/new-client/products.sql
-- A second run changes nothing (SKUs are unique; stock rows are only added when missing).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE client_name = 'Harbor Point Clinics') THEN
    RAISE EXCEPTION 'Create Harbor Point Clinics first (Users > Clients, with samples/unseen/new-client/signup.json)';
  END IF;
END $$;

WITH client AS (
  SELECT client_id FROM clients WHERE client_name = 'Harbor Point Clinics' ORDER BY client_id DESC LIMIT 1
),
wanted (idx, sku, product_name, category, unit_price_usd, unit_weight_kg) AS (
  VALUES (1, 'HP-0001', 'Sterile glove box', 'Medical', 42.50, 3.20),
         (2, 'HP-0002', 'Exam table roll', 'Medical', 18.75, 6.10),
         (3, 'HP-0003', 'Sharps container', 'Medical', 27.00, 1.40)
),
missing AS (
  SELECT w.*, row_number() OVER (ORDER BY w.idx) AS rn
  FROM wanted AS w
  WHERE NOT EXISTS (SELECT 1 FROM products AS p WHERE p.sku = w.sku)
)
INSERT INTO products (product_id, sku, product_name, category, client_id, unit_price_usd, unit_weight_kg)
SELECT 'P' || lpad(((SELECT coalesce(max(substring(product_id FROM 2)::int), 0) FROM products) + m.rn)::text, 4, '0'),
       m.sku, m.product_name, m.category, c.client_id, m.unit_price_usd, m.unit_weight_kg
FROM missing AS m CROSS JOIN client AS c;

INSERT INTO warehouse_products (warehouse_id, product_id, quantity_on_hand, quantity_reserved, reorder_point, bin_location)
SELECT s.warehouse_id, p.product_id, s.on_hand, 0, 20, s.bin
FROM (VALUES ('HP-0001', 'W5', 200, 'C-12-2'),
             ('HP-0002', 'W4', 60, 'A-03-1')) AS s (sku, warehouse_id, on_hand, bin)
JOIN products AS p ON p.sku = s.sku
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

COMMIT;
