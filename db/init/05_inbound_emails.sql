-- Emails received by the Gmail mailbox the API polls (GOOGLE_* in api/.env). Headers, Gmail's snippet and the body as
-- plain text; no attachments. Idempotent, so it runs on first container start and can be re-applied with
-- `psql "$DATABASE_URL" -f 05_inbound_emails.sql`.

CREATE TABLE IF NOT EXISTS inbound_emails (
  -- Gmail's message id: re-polling the same message is a no-op (INSERT ... ON CONFLICT DO NOTHING).
  message_id   TEXT PRIMARY KEY,
  thread_id    TEXT,
  mailbox      TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject      TEXT NOT NULL,
  snippet      TEXT NOT NULL,
  -- The Date header as sent; free text, and senders can put anything in it.
  date_header  TEXT,
  -- When Gmail received it. The poller resumes from the newest one.
  received_at  TIMESTAMPTZ NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_emails_received ON inbound_emails(received_at DESC);

-- The body as plain text (the text/plain part, else the HTML part with tags stripped). NULL for emails stored before
-- this column existed.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS body TEXT;

-- The Foundry email agent's verdict (EmailAgentService). read_by_ai stays false until the agent has answered, so a failed
-- call is retried on the next poll. Added with IF NOT EXISTS so this file can be re-run on an existing database.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS read_by_ai BOOLEAN NOT NULL DEFAULT false;
-- { agent, conversationId, output }: output is the agent's reply, parsed as JSON when it is JSON.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ai_result JSONB;
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ai_read_at TIMESTAMPTZ;
