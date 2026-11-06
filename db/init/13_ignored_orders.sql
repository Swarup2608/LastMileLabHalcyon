-- Order requests Halcyon sets aside so they never reach the staff queue: a blank email, a repeat of one already
-- received, or an email the agent found no order in. Staff can also ignore one by hand, and restore any of them.
-- Idempotent, so it runs on first container start (after 06_order_requests.sql) and can be re-applied with
-- `psql "$DATABASE_URL" -f 13_ignored_orders.sql`.

-- What an email says, as a hash of its sender, subject and body with quoted replies and spacing removed: the same
-- email sent twice has the same fingerprint (see api/src/utils/order-screen.ts).
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS fingerprint TEXT;
-- Why it's ignored: 'blank', 'duplicate', 'not_order' or 'staff'. NULL: in the queue.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ignored_reason TEXT;
-- For a duplicate, the email it repeats.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS duplicate_of TEXT;
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ;
-- The staff member who ignored it; NULL when Halcyon did.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ignored_by UUID;
-- Staff restored it: Halcyon doesn't ignore it again (for instance once the agent has read it).
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS kept_by_staff BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_inbound_emails_fingerprint ON inbound_emails(fingerprint, received_at);

-- An API order's fingerprint (client, reference, lines and address): the same order placed twice within minutes is
-- refused rather than stored twice.
ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_order_requests_fingerprint ON order_requests(client_id, fingerprint);
