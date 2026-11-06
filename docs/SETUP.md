# Halcyon: setup and run guide

Halcyon is an operations portal for a fictional logistics company. It has two apps in one repository:

| Folder | What it is | Runs on |
|---|---|---|
| `api/` | Express API (Node.js, TypeScript) | http://localhost:4000 |
| `web/` | Next.js website and portal | http://localhost:3000 |
| `db/` | PostgreSQL schema, setup scripts and a synthetic dataset | port 5433 (Docker) |

The browser only talks to the web app. The web app forwards every `/api/...` request to the API, and the API talks to PostgreSQL.

This guide takes you from a fresh clone to a signed-in admin in about 10 minutes. The manual steps below were tested against this repository.

---

## Run everything with Docker

This is the quickest way to try Halcyon. It builds and starts PostgreSQL with the dataset, the API and the web app, so you can skip sections 2 to 6. Run these from the repository root:

```bash
npm run up
npm run admin:create -- you@example.com "Your Name"
```

The first start takes about five minutes. `admin:create` prints a password once. Open **http://localhost:3000**, sign in with the **Halcyon staff** toggle and use that password.

Without Node.js, run `docker compose up --build --detach --wait` and `docker compose exec api sh docker-entrypoint.sh node dist/db/create-admin.js you@example.com "Your Name"` instead.

| Command | What it does |
|---|---|
| `npm run down` | Stop everything and keep the data |
| `npm run down -- -v` | Stop everything and delete the database, its generated password and the generated `JWT_SECRET` |

| Service | Address | Setting to change the port |
|---|---|---|
| Web app | http://localhost:3000 | `WEB_PORT` |
| API | http://localhost:4000 | `API_PORT` |
| Database | `localhost:5434` | `DB_PORT` |

If a port is taken, set the new one in your shell when you start, for example `WEB_PORT=3001 npm run up`. In PowerShell, run `$env:WEB_PORT=3001` first.

- **Database password:** the first start generates one and keeps it in the `db-secrets` volume; the API reads it from there. A database created before this needs `npm run down -- -v` once, which deletes its data.
- **`JWT_SECRET`:** you don't need to set it. The first start generates one and keeps it in the `api-secrets` volume, so sign-ins survive a restart. If you do set it, your value is used instead, and it must be at least 32 characters.
- **The manual database:** this database runs beside `halcyon-db` from [step 3](#3-set-up-the-database), which uses port 5433. They hold separate data, so an admin created in one doesn't exist in the other.
- **Optional features:** the containers don't read `api/.env`. To use a feature from [section 8](#8-optional-features), add its settings under `environment:` in the `api` service in `docker-compose.yml`, then run `npm run up` again. Pass secrets through from your shell, for example `SMTP_PASS: ${SMTP_PASS:-}`, so that no secret is saved in the file. Foundry needs `FOUNDRY_API_KEY` here, because `az login` on your machine doesn't reach the container.
- **Local use only:** the database is reachable only from this machine, the API runs in development mode and cookies aren't marked Secure. Azure deployments don't use these Docker files.

---

## 1. What you need

| Tool | Version | Check with |
|---|---|---|
| Node.js | **24 or later** (the repo requires it) | `node -v` |
| npm | comes with Node | `npm -v` |
| Git | any | `git --version` |
| Docker Desktop | any recent version (recommended for the database) | `docker -v` |

No Docker? You can use any PostgreSQL 14+ install instead. See [Option B](#option-b-your-own-postgresql-no-docker).

Nothing else is required. Gmail, Azure AI Foundry, Redis and SMTP are all optional extras covered in [section 8](#8-optional-features).

---

## 2. Get the code and install dependencies

```bash
git clone <your-repo-url> Last-Mile-Labs
cd Last-Mile-Labs
npm run install:all
```

`install:all` installs the root helper (`concurrently`) and then the exact locked dependencies for `api/` and `web/`. It takes a minute or two.

---

## 3. Set up the database

The scripts in `db/init/` create every table and load the CSV files in `db/data/` (48,340 deliveries, 280 clients, and so on). Pick one option.

### Option A: Docker (recommended)

Run this from the repository root:

**macOS / Linux**

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16); echo "$POSTGRES_PASSWORD"
docker run -d --name halcyon-db \
  -e POSTGRES_USER=halcyon \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB=halcyon \
  -p 5433:5432 \
  -v "$PWD/db/init:/docker-entrypoint-initdb.d:ro" \
  -v "$PWD/db/data:/data:ro" \
  postgres:17
```

**Windows (PowerShell)**

```powershell
$env:POSTGRES_PASSWORD = -join (1..32 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }); $env:POSTGRES_PASSWORD
docker run -d --name halcyon-db `
  -e POSTGRES_USER=halcyon `
  -e POSTGRES_PASSWORD="$env:POSTGRES_PASSWORD" `
  -e POSTGRES_DB=halcyon `
  -p 5433:5432 `
  -v "${PWD}/db/init:/docker-entrypoint-initdb.d:ro" `
  -v "${PWD}/db/data:/data:ro" `
  postgres:17
```

On its first start, the container runs all twelve scripts in order. Loading the data takes about 10–30 seconds. Watch it finish with:

```bash
docker logs -f halcyon-db
```

Press `Ctrl+C` once you see `database system is ready to accept connections` after the `/docker-entrypoint-initdb.d` lines.

Your connection string uses the password printed above:

```
postgres://halcyon:<your password>@localhost:5433/halcyon
```

> **Note:** the setup scripts only run when the database is empty. If you change a script later, see [Resetting the database](#resetting-the-database).

### Option B: your own PostgreSQL (no Docker)

Create a user and database (adjust names and password to taste):

```bash
psql -U postgres -c "CREATE USER halcyon WITH PASSWORD 'halcyon';"
psql -U postgres -c "CREATE DATABASE halcyon OWNER halcyon;"
```

Then, **from the repository root**, load the schema and data. The first script is written for Docker, where the CSVs live at `/data`. This command rewrites those lines to load the files from your clone instead:

```bash
export DATABASE_URL=postgres://halcyon:<your password>@localhost:5432/halcyon

sed -E "s#^COPY (.*) FROM '/data/(.*);\$#\\\\copy \1 FROM 'db/data/\2#" db/init/01_schema.sql \
  | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"

for f in db/init/0[2-9]_*.sql db/init/1[0-9]_*.sql; do
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$f"
done
```

Use port `5432` (or whatever your server uses) in `DATABASE_URL` in the next step. On Windows, run these commands in Git Bash or WSL.

---

## 4. Configure the API

```bash
cp api/.env.example api/.env
```

Open `api/.env` and set these values. Everything else can stay as it is.

```dotenv
# Docker option. Use your own host/port for Option B.
DATABASE_URL=postgres://halcyon:<your password>@localhost:5433/halcyon

# Any random string of 32+ characters. Generate one with: openssl rand -base64 48
JWT_SECRET=paste-a-long-random-string-here
```

Rules the API enforces on startup:

- `JWT_SECRET` must be at least 32 characters.
- The optional groups (Gmail, Foundry, SMTP) must be **completely filled in or completely empty**. `.env.example` leaves them empty, which is correct.

> **Safari users:** auth cookies are marked Secure, which Safari refuses on plain `http://localhost`. Set `COOKIE_SECURE=false` for local development. Chrome, Edge and Firefox work without it.

### Create your first admin

The API doesn't create an admin from settings. With the database running, create one once, from `api/`:

```bash
cd api
npm run admin:create -- you@example.com "Your Name"
```

```
Admin ready: you@example.com
Password:    abcd-efgh-2jkm-npqr
Shown once. Sign in with the Halcyon staff toggle, then change it from Account settings.
```

The password is generated and shown only here; just its hash is stored. Running the command again for the same email resets that account to an active admin with a new password and signs it out everywhere, so it also gets you back in after a lockout. On a deployed API (no `tsx`), run `node dist/db/create-admin.js you@example.com` instead.

If an older `api/.env` still has `ADMIN_EMAIL` or `ADMIN_PASSWORD`, the API ignores them and logs a reminder to remove them.

The web app needs no configuration for local use. It finds the API at `http://localhost:4000` by default. If you run the API somewhere else, set `API_URL` (for example in `web/.env.local`).

---

## 5. Run it

From the repository root:

```bash
npm run dev
```

This starts both apps side by side, with the API's output in blue and the web app's in green. A healthy API start looks like this:

```
login rate limiter: in memory
email poller: off (GOOGLE_* not set)
email agent: off (FOUNDRY_* not set)
carrier agent: off (FOUNDRY_CARRIER_AGENT_NAME not set)
stock transfers: immediate
allocation agent: off (FOUNDRY_ALLOCATION_IQ_AGENT_NAME not set)
halcyon-api listening on http://localhost:4000
```

The `off (...)` lines are expected: those are the optional features from section 8.

To run just one app, use `npm run dev:api` or `npm run dev:web`. Stop everything with `Ctrl+C`.

---

## 6. Sign in

1. Open **http://localhost:3000/signin**.
2. Switch the toggle from **Client** to **Halcyon staff**. *This step matters: the form starts on Client, and staff accounts are rejected there with "Email or password is incorrect".*
3. Sign in with the email and the password `npm run admin:create` printed.

You land on the staff portal at `/portal`.

### Adding more users

As the admin, you can create:

- **Contributors and other admins** from the **Team** page.
- **Client logins** from **Clients**: open a client and add a user. Client users sign in with the **Client** toggle and only ever see their own company's orders and products.

The sign-in page can also show one-click **demo accounts** for any user you mark as demo, admins included. A demo account's password is public. A demo *admin* can do everything an admin does except create or promote admins (SEC-01), so turn demo off on admins before any public demo.

---

## 7. Check that everything works

| Check | Expected |
|---|---|
| http://localhost:4000/health | `{"status":"ok", ...}` |
| http://localhost:4000/ready | `{"status":"ready","checks":{"database":"ok"}}` |
| http://localhost:3000 | The Halcyon landing page |

To inspect the database contents, from `api/` run:

```bash
npm run db:tables
```

On a fresh setup, you should see these counts, among others:

| Table | Rows |
|---|---|
| `deliveries` | 48,340 |
| `clients` | 280 |
| `sla_penalties` | 4,847 |
| `warehouse_products` | about 3,300 (randomly generated) |
| `products` | 1,680 |
| `staff` | 1 (your admin, after step 4) |

To look at one table, run `npm run db:tables clients` (first 50 rows) or `npm run db:tables clients all`. Password hashes are masked, and the command never writes anything.

### Run the tests

```bash
cd api
npm test
```

You should see `fail 0` and `todo 0`. The tests use an in-memory database, so PostgreSQL doesn't need to be running.

The browser tests need Docker and start their own throwaway copy of the app, on ports 3100, 4100 and 5534:

```bash
(cd e2e && npm ci && npx playwright install chromium)   # once
npm run test:e2e
```

Set `E2E_WEB_PORT`, `E2E_API_PORT` or `E2E_DB_PORT` if one of those ports is taken.

---

## 8. Optional features

Each feature switches on when its settings in `api/.env` are filled in, and its startup line changes from `off` to on. Restart the API after editing `.env`.

### Read orders from a Gmail inbox

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
EMAIL_POLL_INTERVAL_SECONDS=60
```

1. In Google Cloud Console, enable the **Gmail API** and create an **OAuth client**.
2. Get a refresh token for the mailbox with the `https://www.googleapis.com/auth/gmail.readonly` scope (the OAuth 2.0 Playground works for this).
3. New mail is copied into the database and appears under **Emails** in the staff portal.

### AI agents (Azure AI Foundry)

Create the agents in one Azure AI Foundry project, then fill in:

```dotenv
FOUNDRY_PROJECT_ENDPOINT=https://<your-project-endpoint>
FOUNDRY_API_KEY=                          # optional, see below

FOUNDRY_AGENT_NAME=...                    # reads each inbound email
FOUNDRY_DRAFT_AGENT_NAME=...              # optional: drafts out-of-stock emails to customers
FOUNDRY_CARRIER_AGENT_NAME=...            # optional: same-day carrier plan
FOUNDRY_ALLOCATION_IQ_AGENT_NAME=...      # optional: Inventory → Rebalance suggestions
```

- `FOUNDRY_PROJECT_ENDPOINT` and `FOUNDRY_AGENT_NAME` go together; the other three agents need the endpoint too.
- With `FOUNDRY_API_KEY` empty, the API signs in through `DefaultAzureCredential`. Locally that means running `az login` first.
- Each agent's own instructions in Foundry define its output format. The comments in `api/.env.example` describe exactly what the API sends to each one.

Without these settings, the portal still works. Customer drafts fall back to a template, and the carrier plan and rebalance buttons say they're not set up.

### Let clients email an order from the portal

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@gmail.com
SMTP_PASS=<app password>
ORDER_INBOX=orders@yourdomain.com   # the mailbox the Gmail poller reads
```

### Shared login rate limits (Redis)

```dotenv
REDIS_URL=rediss://default:<token>@<host>:6379
```

Without it, the login rate-limit counters live in memory and reset whenever the API restarts. That's fine for local development.

---

### Demo mode

Set this in `api/.env`, or for `npm run up` in your shell or a `.env` file next to `docker-compose.yml`, then restart the API.

`DEMO_MODE=false` turns demo accounts off: none appear on the sign-in page, they can't sign in or renew a session, and none can be turned on from **Users**. The default is `true`.

## 9. Run a production build locally

```bash
# API
cd api
npm run build
npm start                      # runs node dist/server.js

# Web (in a second terminal)
cd web
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
PORT=3000 API_URL=http://localhost:4000 node .next/standalone/server.js
```

The web app is built in standalone mode, which is why it runs `server.js` instead of `next start`. These are the same steps the GitHub Actions workflow uses before deploying to Azure.

---

## 10. Other useful commands

| Where | Command | What it does |
|---|---|---|
| root | `npm run build` | Build API, then web |
| root | `npm run typecheck` | Type-check the API |
| root | `npm run lint` | Lint the web app |
| `api/` | `npm run sim:week` | Simulate next week, before and after Halcyon's rules (read-only) |
| `api/` | `npm run sim:week -- --start 2026-11-02 --seed 7 --runs 20 --out week.md` | Same, with options, saved to a file |
| `api/` | `npm run sim:week -- --agent` | Also ask the real carrier agent about Monday |

---

## Resetting the database

**Docker:** remove the container and its data, then run the `docker run` command from step 3 again.

```bash
docker rm -f -v halcyon-db
```

To stop the database without losing data, use `docker stop halcyon-db`. Start it again with `docker start halcyon-db`.

**Re-applying one script:** every script except `01_schema.sql` is safe to run again:

```bash
psql "postgres://halcyon:<your password>@localhost:5433/halcyon" -f db/init/08_settings.sql
```

---

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| API exits on start with a list of setting errors | `api/.env` is missing a value or has a half-filled group. The message names the setting, e.g. `JWT_SECRET must be at least 32 characters` or `set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, or none`. |
| `DATABASE_URL is required` | You ran the API without `api/.env`. Do step 4. |
| `ECONNREFUSED ... 5433` | The database isn't running. Run `docker start halcyon-db`, or check the port in `DATABASE_URL`. |
| `port is already allocated` from Docker | Something else uses port 5433. Change `-p 5433:5432` to another port, e.g. `-p 5434:5432`, and update `DATABASE_URL`. |
| Tables are empty or missing | The setup scripts didn't run, usually because the container was first started without the `-v` mounts. Reset the database (see above) and rerun step 3 from the repo root. |
| "Email or password is incorrect" for the admin | The sign-in form is on **Client**. Switch to **Halcyon staff**. |
| Web shows "API unavailable", or the terminal shows `api proxy: upstream unreachable` | The API isn't running, or it isn't at `http://localhost:4000`. Start it, or set `API_URL` for the web app. |
| Signed in, but sent straight back to sign-in (Safari) | Set `COOKIE_SECURE=false` in `api/.env` and restart the API. |
| Requests refused with an origin error | You opened the web app on a different address than `CORS_ORIGINS` allows (e.g. `127.0.0.1` instead of `localhost`). Use http://localhost:3000, or add your address to `CORS_ORIGINS`. |
| `npm ci` complains about the Node version | Install Node.js 24 or later. |

---

## About the data

Everything in `db/data/` is **synthetic** hackathon data. No real client, carrier, person or address appears in it. See [db/data/README.md](../db/data/README.md) for the scenario and [db/data/DATA_DICTIONARY.md](../db/data/DATA_DICTIONARY.md) for every column.
