# Security re-check against SECURITY.md

Run on 31 October 2026 at commit `03d24ed` plus working-tree changes, read-only, by the `security-verifier` agent.

**Results:** 189 API tests pass, `npm audit --omit=dev` finds 0 vulnerabilities in `api/` and `web/`, and no real secret was found in tracked files or history (regex scans; `gitleaks` wasn't available).

| ID | Claim checked | Status | Note |
|---|---|---|---|
| G1 | "Privilege escalation: none found" | **Open, high** | A demo admin can gain lasting admin access through account-management routes other than the direct create and promote paths |
| G2 | Agents can't act on their own | Partly | Transfers hold. An agent "no order" reply sets an email aside, and the browser auto-routes complete orders from the agent's reading |
| G3 | Nothing personal leaves for Foundry | Partly | True for rebalance. The email, draft and carrier agents receive customer or address details |
| G4 | Client isolation | Partly | ID checks hold. Linking an email to a client trusts the From header and addresses written in the body |
| G5 | Agent replies are never stored as they are | Open, low | Email replies and carrier reports are stored whole |
| G6 | Audit is append-only and covers everything | Partly | Append-only by convention; simulation routes and bad-origin refusals aren't logged |
| G7 | 320+ checks on every route | Partly | The role matrix has 38 entries (152 checks); some routes are missing from it, though their guards exist |
| G8 | Portal guard | Partly | `/portal/insights` is missing from the proxy's route list; its client-side gate is staff-only |
| G9 | `.strict()` on updates | Partly | Extra fields on `saveRequestSchema` are dropped, not refused |
| G10 | Every API response is no-store | Partly | Bad-origin and body-parse errors skip it; they carry no data |
| G11 | Never innerHTML | Partly | One admin view builds HTML from validated names; no exploit found |
| G12 | Stock-out limit | Partly | The log ignores lines over 10,000 cartons, while orders can reach 100,000 |
| G13 | Results header | Stale | Test count and suite table are out of date |
| G14 | Passwords hashed | By design | Demo passwords are readable and shown publicly (SEC-01); SECURITY.md doesn't mention this exception |

18 other claims hold, including token handling, session revocation, cookies, password hashing, rate limits, CSRF checks, parameterised SQL, audit privacy and retention.

Also noted: the web app sends no CSP or frame-protection headers, and the default JWT secret removed from `docker-compose.yml` remains in git history, so it should never be reused.
