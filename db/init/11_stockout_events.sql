-- Stock-outs at the nearest warehouse: an order line the warehouse nearest its delivery region couldn't cover when the
-- order was routed (or flagged out of stock). Written by the API whenever staff, or auto-routing, decide where a request
-- ships from; re-written when that decision changes, and removed when it's undone. Inventory lists them, and the
-- allocation agent's rebalance input counts them per warehouse. Idempotent, so it runs on first container start and can
-- be re-applied with `psql "$DATABASE_URL" -f 11_stockout_events.sql`.

CREATE TABLE IF NOT EXISTS stockout_events (
  id                   BIGSERIAL PRIMARY KEY,
  -- The order request (an email's message id, or an API order's id).
  request_id           TEXT NOT NULL,
  product_id           TEXT NOT NULL REFERENCES products(product_id),
  -- Delivery region of the order, and the warehouse fewest miles from it.
  region               TEXT NOT NULL,
  nearest_warehouse_id TEXT NOT NULL REFERENCES warehouses(warehouse_id),
  quantity             INT  NOT NULL CHECK (quantity > 0),
  -- Cartons available at the nearest warehouse when the decision was made (less than quantity).
  available_at_nearest INT  NOT NULL CHECK (available_at_nearest >= 0),
  -- rerouted: shipped from a farther warehouse. delayed: staff offered a new delivery date from the nearest one.
  -- shipped_short: routed to the nearest warehouse anyway.
  resolution           TEXT NOT NULL CHECK (resolution IN ('rerouted', 'delayed', 'shipped_short')),
  -- Where it ships from (NULL when delayed), and how many more miles that is to the region than the nearest.
  shipped_from_id      TEXT REFERENCES warehouses(warehouse_id),
  extra_miles          INT,
  -- When the routing or stock flag was decided.
  decided_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, product_id)
);

CREATE INDEX IF NOT EXISTS stockout_events_decided_at_idx ON stockout_events (decided_at);
CREATE INDEX IF NOT EXISTS stockout_events_product_idx ON stockout_events (product_id, nearest_warehouse_id);
