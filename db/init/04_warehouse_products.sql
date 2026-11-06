-- Warehouse x product stock levels: the join table between warehouses and products. Synthetic, like 03_products.sql:
-- every product is stocked in 1-3 random warehouses. Idempotent, so it runs on first container start (after
-- 03_products.sql) and can be re-applied with `psql "$DATABASE_URL" -f 04_warehouse_products.sql`; rows are only
-- generated while the table is empty.

CREATE TABLE IF NOT EXISTS warehouse_products (
  warehouse_id      TEXT NOT NULL REFERENCES warehouses(warehouse_id),
  product_id        TEXT NOT NULL REFERENCES products(product_id),
  quantity_on_hand  INT  NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved INT  NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  reorder_point     INT  NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  bin_location      TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id),
  CHECK (quantity_reserved <= quantity_on_hand)
);

CREATE INDEX IF NOT EXISTS warehouse_products_product_id_idx ON warehouse_products (product_id);

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
CROSS JOIN LATERAL (SELECT floor(random() * 500)::int AS on_hand) AS s
WHERE NOT EXISTS (SELECT 1 FROM warehouse_products);

-- Readable warehouse x product view with names, owning client and availability.
CREATE OR REPLACE VIEW warehouse_product_stock AS
SELECT
  wp.warehouse_id,
  w.warehouse_name,
  w.region,
  wp.product_id,
  p.sku,
  p.product_name,
  p.category,
  p.client_id,
  c.client_name,
  wp.quantity_on_hand,
  wp.quantity_reserved,
  wp.quantity_on_hand - wp.quantity_reserved AS quantity_available,
  wp.reorder_point,
  (wp.quantity_on_hand - wp.quantity_reserved) <= wp.reorder_point AS needs_reorder,
  wp.bin_location,
  wp.updated_at
FROM warehouse_products AS wp
JOIN warehouses AS w ON w.warehouse_id = wp.warehouse_id
JOIN products   AS p ON p.product_id   = wp.product_id
JOIN clients    AS c ON c.client_id    = p.client_id;
