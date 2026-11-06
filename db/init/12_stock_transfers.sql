-- Stock transfers between warehouses, applied by staff from Inventory's Rebalance (the allocation agent's suggestion,
-- as they edited it). Applying takes the cartons out of the source at once; they reach the destination
-- STOCK_TRANSFER_DELAY_DAYS later (0: at once), when the API marks the transfer completed and adds them there. Idempotent,
-- so it runs on first container start and can be re-applied with `psql "$DATABASE_URL" -f 12_stock_transfers.sql`.

CREATE TABLE IF NOT EXISTS stock_transfers (
  id             BIGSERIAL PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(product_id),
  source_id      TEXT NOT NULL REFERENCES warehouses(warehouse_id),
  destination_id TEXT NOT NULL REFERENCES warehouses(warehouse_id),
  quantity       INT  NOT NULL CHECK (quantity > 0),
  -- in_transit: taken from the source, not yet at the destination. completed: added to the destination.
  status         TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'completed')),
  -- "suggested" when it's the agent's transfer as given, "edited" when staff changed or added it.
  origin         TEXT NOT NULL CHECK (origin IN ('suggested', 'edited')),
  reason         TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrives_at     TIMESTAMPTZ NOT NULL,
  completed_at   TIMESTAMPTZ,
  CHECK (source_id <> destination_id)
);

CREATE INDEX IF NOT EXISTS stock_transfers_due_idx ON stock_transfers (status, arrives_at);
CREATE INDEX IF NOT EXISTS stock_transfers_created_idx ON stock_transfers (created_at);
