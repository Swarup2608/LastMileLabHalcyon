-- Halcyon auth schema: logins for client users and staff (admins and contributors), plus refresh-token sessions.
-- Idempotent, so it runs on first container start and can be re-applied with `psql "$DATABASE_URL" -f 02_auth.sql`.

-- Halcyon employees. Admins manage staff and client logins; contributors work the operations console.
CREATE TABLE IF NOT EXISTS staff (
  staff_id      UUID PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'contributor')),
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- People who sign in on behalf of a client company; a client can have several.
CREATE TABLE IF NOT EXISTS client_users (
  client_user_id UUID PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name      TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_users_client ON client_users(client_id);

-- One row per issued refresh token. Refreshing rotates the row (revoked_at + replaced_by); presenting a
-- revoked token again is treated as theft and revokes the whole family.
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id     UUID PRIMARY KEY,
  family_id      UUID NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('staff', 'client')),
  principal_id   UUID NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  replaced_by    UUID,
  user_agent     TEXT,
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_principal ON auth_sessions(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON auth_sessions(family_id);

-- Demo accounts: listed on the sign-in page, with their password, for one-click demo sign-in. demo_password holds
-- that (generated) password readable only while is_demo is true; turning demo off clears it and replaces the
-- password. Added with IF NOT EXISTS so this file can be re-run on an existing database.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS demo_password TEXT;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS demo_password TEXT;

-- Who did what, when, from where: sign-ins (and failed ones), sign-outs, refresh-token theft, account changes, every
-- admin change to staff and client logins, reads of client data, and refused (403) requests. Append-only from the
-- API: rows are inserted and read, never updated or deleted. actor_* is null for an anonymous actor (a failed
-- sign-in). details never holds a password.
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id    UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type  TEXT CHECK (actor_type IS NULL OR actor_type IN ('staff', 'client')),
  actor_id    UUID,
  actor_role  TEXT CHECK (actor_role IS NULL OR actor_role IN ('admin', 'contributor', 'client')),
  action      TEXT NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  target_type TEXT,
  target_id   TEXT,
  details     JSONB,
  ip          TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
