# Halcyon security checks passed

The security controls in Halcyon's sign-in, sessions and role-based access, and the checks they pass. The
results come from our own audits of 28, 29 and 30 October 2026, plus an external re-test of build `d699e16`
(manual requests, Semgrep, Gitleaks, npm audit), each re-checked against `main`.

Scope: the API (`api/src`), the auth and product schema (`db/init`), and the web client's auth, route guards and
`/api` forwarder (`web/src`).

## Latest results (31 Oct 2026)

```
cd api && npm test               # pg-mem in-memory Postgres; never touches DATABASE_URL
ℹ tests 189  ℹ pass 189  ℹ fail 0  ℹ todo 0
cd api && npm audit --omit=dev   # found 0 vulnerabilities
cd web && npm audit --omit=dev   # found 0 vulnerabilities
```

| Check | Result |
|---|---|
| Role checks: every API route × 4 roles (anonymous, client, contributor, admin) | ✅ 320+ checks pass |
| SQL injection probes | ✅ 34 probes, none succeed |
| Stored XSS, including AI output and email bodies | ✅ 27 page loads, none execute |
| Token forgery: `alg=none`, wrong secret, HS512, expired, tampered `clientId`, missing `sid` | ✅ All refused |
| CSRF: `Origin: null`, look-alike origin, through the `/api` proxy | ✅ All refused |
| Client isolation: another company's id | ✅ 404, never their data |
| IDOR, secrets in responses | ✅ None found |
| Privilege escalation | ⚠️ One accepted risk: a demo admin can reach lasting admin access through other account changes. Demo accounts exist only for the hackathon and are deleted when it ends |
| Dependency advisories (`api/`, `web/`) | ✅ 0 vulnerabilities |

## Authentication

- **Passwords** are hashed with **argon2id** (64 MiB memory, 3 passes, 4 lanes), above the OWASP minimum. Old scrypt
  hashes are upgraded on the next successful sign-in, and a wrong password never triggers the upgrade.
- **Password rules** (10–256 characters, a letter and a number) apply on every path: admin create and reset, client
  sign-up, client logins, changing your own password, and `npm run admin:create`. The web forms share one copy of the rule.
- **Generated passwords** have about 79 bits of entropy.
- **Login doesn't reveal which emails exist.** The error is the same in every case, and unknown emails are checked
  against a dummy hash so the timing matches a wrong password.
- **Brute-force limits** apply per IP and per account. The per-account limit holds across any number of IPs; the per-IP
  limit drops the port and groups IPv6 by subnet, so rotating ports or addresses doesn't reset it.
- **No admin from environment variables.** The first admin comes from `npm run admin:create`, which prints the
  generated password once and stores only the hash.

## Sessions and tokens

- **HS256 is pinned**, issuer and audience are checked, and access and refresh tokens use separate audiences.
- **Tokens travel only in `httpOnly` cookies.** The refresh cookie is scoped to `/api/auth`.
- **Refresh tokens are single use**, claimed by an atomic `UPDATE`. Replaying one revokes the whole session family and
  is audited as `auth.refresh_reuse`.
- **Revocation takes effect on the next request.** Each access token carries its session id, and every request checks
  that the session is live and the account active, then reads role and client from the database, not the token.
  Logout, logout-all, deactivation, role change and password reset all cut off a live token (tested).
- **Changing your email or password** needs your current password and ends every other session.

## Authorization

- **Every route enforces its role.** The RBAC test matrix covers every route for all four roles, including the
  products, rebalance, stock-out and stock-transfer endpoints.
- **Staff and client realms are separate.** A client sees only their own company: the client id comes from the
  database-backed session, never from the request. A client with no client id matches no rows (fail closed).
- **The removed database endpoints stay removed.** The old `/api/admin/db/*` paths return 404 for every role.
- **Web route guards run on the server.** `web/src/proxy.ts` checks every `/portal` request with the API before serving
  the page, so revocation applies there too. The sign-in `next=` parameter must be a `/portal` path, so it can't be an
  open redirect.

Hand test of the server route guard (`next start` against a stub API, every role):

| Visitor | `/portal`, `/portal/account` | `/portal/clients` | `/portal/team`, `/portal/clients/new` |
|---|---|---|---|
| Anonymous, or an expired or revoked token | → `/signin?next=…` | → `/signin?next=…` | → `/signin?next=…` |
| Client | 200 | → `/portal` | → `/portal` |
| Contributor | 200 | 200 | → `/portal` |
| Admin | 200 | 200 | 200 |

## Input and output handling

- **Every input goes through zod.** Updates use `.strict()`, so extra fields are refused (no mass assignment).
- **All SQL is parameterised.**
- **CSRF protection:** an origin check on every write, plus SameSite cookies and a JSON-only body parser.
- **Hardening:** `helmet` on the API, a 100 kB JSON body limit, errors that don't leak internals, and config validated
  at startup.
- **No caching of API data.** Every `/api` response is `Cache-Control: no-store`; guarded portal pages are
  `private, no-store`.
- **The `/api` forwarder** always targets the fixed `API_URL` host and doesn't follow redirects, so it can't be steered
  to another server.

## AI agents

- **Agent replies are untrusted.** They're parsed as JSON and checked against what was sent; unknown warehouses and
  products are dropped, and numbers and enums are coerced. Replies render as React text, never `innerHTML`, and are
  never written to the database as they are.
- **Nothing personal leaves for Foundry.** The rebalance agent gets SKUs, product names, stock, reorder points, demand
  counts and distances. No customer names, addresses, emails or client ids.
- **Email content is data, not instructions.** Prompt-injection samples in `api/test/bad-input.test.ts` pass: an
  injected order note is stored as plain text and triggers nothing.
- **Agents can't act on their own.** Only transfers staff review and apply are saved, and they're re-validated on the
  server.

## Stock transfers and stock-outs

- **All or nothing.** A batch with any short source is refused whole (409) with stock untouched; a conditional update
  inside the transaction guards against a concurrent apply.
- **Bounded input:** 1–10,000 units per line, at most 200 transfers per apply; warehouses must exist and differ.
- **Server-side numbers.** Stock-out lines are checked (products exist, 1–10,000 units, at most 100 lines), and the
  nearest warehouse, its stock and the extra miles are worked out on the server.
- **Fault isolation.** A stock-out log failure doesn't fail the routing save.

## Audit and retention

- **Append-only audit log** of sign-ins, account changes, every admin, contributor and client action, refused (403)
  requests and refresh-token reuse. Each row records the actor, action, outcome, target, IP and user agent.
- **Passwords are never logged.** A reset is recorded only as `passwordReset: true`, and the tests check for it.
- **Only admins can read the log**, and those reads are logged too.
- **Retention runs every 6 hours.** Sessions are deleted 30 days after expiry, audit rows after 365 days (both
  configurable). A revoked session is kept until it expires, so a replayed token is still caught.

## Test suites

| Area | File |
|---|---|
| Login, sessions, rotation and reuse, sign-up, own account, demo, CSRF, rate limits, products | `api/test/auth.test.ts` |
| RBAC matrix, cross-realm sessions, escalation, IDOR, token forgery, CSRF, revocation, rate-limit keys, audit, cache headers, retention, argon2id, demo admins, first admin | `api/test/security.test.ts` |
| Stock-out rules | `api/test/stockouts.test.ts` |
| Rebalance input and agent-reply validation | `api/test/rebalance.test.ts` |
| Bad and hostile input from `samples/` through the real routes | `api/test/bad-input.test.ts` |

All 189 pass.
