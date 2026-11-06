-- Order requests as staff work them: products mapped, quantities, address fixes, what was asked of the customer and
-- where it was routed, plus which client account it belongs to. A request arrives by email, EDI or API, like
-- clients.primary_order_channel. Email requests are the inbound email (message_id), and their row is created the
-- first time staff change something on the Resolve screen. Idempotent, so it runs on first container start (after
-- 05_inbound_emails.sql) and can be re-applied with `psql "$DATABASE_URL" -f 06_order_requests.sql`.

CREATE TABLE IF NOT EXISTS order_requests (
  -- An email request's id is its Gmail message id.
  request_id  TEXT PRIMARY KEY,
  channel     TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'edi', 'api')),
  -- Only email requests come from an inbound email.
  message_id  TEXT UNIQUE REFERENCES inbound_emails(message_id) ON DELETE CASCADE,
  -- Set by staff: client_set = true means client_id is their choice (NULL = deliberately unlinked). While false, an
  -- email request's client is the one whose login sent the email or is written in it (see EmailRepository).
  client_set  BOOLEAN NOT NULL DEFAULT false,
  client_id   TEXT REFERENCES clients(client_id),
  -- The web app's RequestEdits as JSON, apart from the client link.
  edits       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((channel = 'email') = (message_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_order_requests_client ON order_requests(client_id);

-- API requests (POST /api/order-requests from the client portal or a client's own system): the order as the client sent
-- it, in the shape the email agent replies in ({ customer, products: [{ sku, quantity }], address, city, state,
-- postal_code, … }), so staff work it like an emailed one; and the client user who placed it. NULL for email requests.
-- Added with IF NOT EXISTS so this file can be re-run on an existing database.
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS order_payload JSONB;
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS created_by UUID;

-- Order intake: when the request first became ready to route (product, quantity and a complete address all in). The
-- same-day cutoff (08:00) is judged against this, not against when the email arrived. Set once, never moved, even if the
-- request later changes. Added with IF NOT EXISTS so this file can be re-run on an existing database.
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS intake_at TIMESTAMPTZ;

-- The carrier staff assigned the order to (Assign on the carrier plan). Set once, never moved. delivered_at is when it
-- counts as delivered, 4-5 hours after assigned_at: simulated, as there's no carrier tracking feed yet. Added with
-- IF NOT EXISTS so this file can be re-run on an existing database.
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS assigned_carrier TEXT;
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS assigned_by UUID;
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
