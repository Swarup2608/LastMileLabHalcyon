# Unseen input kit

31 October 2026

Input that Halcyon was not built or tested against, for showing a juror that it works beyond the prepared samples. None of these files is loaded by `api/test/bad-input.test.ts`, and none was run through the app before the demo. The "Watch for" column says what to look for, not a result that has been checked: the email agent reads each one live, so what it extracts can vary.

| Part | Files | What it shows |
|---|---|---|
| [Four new email layouts](#1-four-new-email-layouts) | `email/*.json` | The email agent and Resolve on layouts unlike the ones in `samples/email/` |
| [A new client, end to end](#2-a-new-client-end-to-end) | `new-client/` | Onboarding with no code: sign-up, catalogue, first order, routing |
| [Another week](#3-the-week-simulation-on-another-week) | none | `sim:week` on a week and seed never used before |
| [10× load](#4-the-10-load-test) | none | `bench:scale` ready to run |

Do all of this on a local or staging database, never production.

## 1. Four new email layouts

Every email in `samples/email/` uses one layout: "PO number:", "Products:", "Ship to:". The dataset has 14 layouts (`email_format_id` in `db/data/deliveries.csv`). These four look nothing like the prepared one.

| File | Layout | From | Watch for |
|---|---|---|---|
| [`table-paste.json`](email/table-paste.json) | A forwarded purchase order: line items in a pipe table, units as `CS`, address in capitals with abbreviations and ZIP+4 (`200 W MADISON ST FL 3`, `60606-3401`), PO number only in the subject and the forwarded header | Dana Ortiz, `C001` | Linked to `C001` by Dana's address, not the forwarded system sender. Two lines (24 × `HA-1037`, 6 × `ME-1074`). Address complete, so the region is Midwest |
| [`reply-thread.json`](email/reply-thread.json) | A reply three deep: "Same again please, but make it 30 this time instead of 18. Today if you can." The product and address appear only in the quoted older messages | Dana Ortiz, `C001` | Quantity 30, not the quoted 18. Product and address taken from the quoted text. Staff confirm before anything is routed. Same-day only if it arrives before the 08:00 New York cutoff, else promised the next day |
| [`machine-format.json`](email/machine-format.json) | A system-generated, pipe-delimited message (`HDR|PO=88213|…`, `SHP|…`, `LIN|001|SKU=HA-1037|QTY=12|…`) with no greeting | Dana Ortiz, `C001` | PO 88213, two lines, full address read from `SHP` fields. If `OU-1111` isn't in `C001`'s catalogue in your database, Resolve marks it "Not in catalogue" |
| [`new-client-two-sites.json`](email/new-client-two-sites.json) | One email, two clinics, each with its own items and address | Ines Park, the new client from part 2 | Linked to Harbor Point Clinics only after part 2 has created its login. One request holds one delivery address, so staff see two sites in one email and must split it or ask the client. `HP-0003` has no stock anywhere |

**Load them.** With Gmail set up, send each file's `subject` and `body` to the order inbox from the sender's address. Without Gmail, load them straight into the inbox table from the repository root, as in [`docs/DEMO.md`](../../docs/DEMO.md) step 6. This stamps them with the current time, so the same-day cutoff applies to when you load them:

```bash
for f in table-paste reply-thread machine-format new-client-two-sites; do
  docker exec -i halcyon-db psql -U halcyon -d halcyon -v email="$(cat samples/unseen/email/$f.json)" <<'SQL'
INSERT INTO inbound_emails (message_id, thread_id, mailbox, from_address, subject, snippet, body, date_header, received_at)
SELECT e->>'messageId', e->>'threadId', 'demo', e->>'from', e->>'subject', e->>'snippet', e->>'body', e->>'dateHeader', now()
FROM (SELECT :'email'::jsonb AS e) AS s ON CONFLICT (message_id) DO NOTHING;
SQL
done
```

The first three need the `C001` login `dana.ortiz@client001.example` ([`docs/DEMO.md`](../../docs/DEMO.md) step 4). Without the email agent configured, they arrive unread and **Analyze now** says the agent isn't configured.

## 2. A new client, end to end

Harbor Point Clinics, a West-region client that doesn't exist in the dataset. Its three products are set up so one order shows each routing case.

| SKU | Stock | Shows |
|---|---|---|
| `HP-0001` | 200 in W5 (West) | Ships from the nearest warehouse |
| `HP-0002` | 60 in W4 (Northeast) only | Nearest warehouse is short, so it ships from far away and a stock-out is logged |
| `HP-0003` | None | Out of stock everywhere: staff can draft a notice with a new date |

1. **Sign up the client.** Edit [`new-client/signup.json`](new-client/signup.json) first: replace `CHANGE-ME` with a password of at least 10 characters (the API refuses `CHANGE-ME`). Signed in as an admin, use **Users › Clients**, or run in the browser console:

   ```js
   await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `PASTE signup.json HERE` })
     .then(async (r) => [r.status, await r.json()])   // 201
   ```

2. **Load its catalogue and stock.** Products have no screen or API route, so this is SQL ([`new-client/products.sql`](new-client/products.sql)). It stops with a clear error if step 1 hasn't been done, and a second run changes nothing.

   ```bash
   docker exec -i halcyon-db psql -U halcyon -d halcyon < samples/unseen/new-client/products.sql
   ```

3. **Place the first order.** In a private window, sign in as `purchasing@harborpoint.example` with the **Client** toggle. Use **New order**, or paste [`new-client/order.json`](new-client/order.json) (12 × `HP-0001`, 5 × `HP-0002` to Seattle) into the console:

   ```js
   await fetch('/api/order-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `PASTE order.json HERE` })
     .then(async (r) => [r.status, await r.json()])   // 201
   ```

   Watch for: 201 with a `REQ-…` reference and an expected delivery date from the cutoff rule. On Resolve, staff see `HP-0001` suggested from W5 and `HP-0002` from W4. Routing is a suggestion staff confirm; once they save it, the stock-out log shows W5 short of `HP-0002`.

4. **Send an email as the new client.** Load `new-client-two-sites.json` from part 1. It's now linked to Harbor Point Clinics because its sender is the client's login.

## 3. The week simulation on another week

The published figures use `--start 2026-11-02 --seed 1`. This runs a different week with a seed never used, and writes its own report:

```bash
cd api && npm run sim:week -- --start 2026-12-07 --seed 99 --runs 20 --out sim-week-2026-12-07-seed99.md
```

It only reads the database. 7 December 2026 is a Monday. Orders for each day are drawn from real deliveries on the same weekday, so the date sets the calendar and the seed sets the draw. The run checks itself: the "before" on-time rate must match history within 3 points, or it exits with an error. Compare its on-time change and per-rule split with [`api/sim-week-2026-11-02.md`](../../api/sim-week-2026-11-02.md); the figures should land in the same range, not match exactly. Add `--agent` to also ask the live carrier agent about Monday.

## 4. The 10× load test

```bash
cd api && npm run bench:scale -- --levels 1,10 --out scale-unseen.md
```

Before running it:

- **Stop `npm run dev`.** The test copies the database with `CREATE DATABASE … TEMPLATE`, which fails while anything else is connected to it.
- **Point `DATABASE_URL` at a local or staging database.** It reads the source and fills a scratch copy (`<name>_scale`) with six months of orders, then drops the copy. The source isn't changed.
- **Give Postgres 1 GB of shared memory.** With Docker's default 64 MB, about half the 10× requests fail with `dsm_impl_posix` errors ([`docs/SCALE.md`](../../docs/SCALE.md), Earlier run). The Quick start container doesn't set it, and it can't be changed on a running container. Recreate it with `--shm-size=1g` added to the `docker run` in the README. That starts an empty database, so the init scripts load the dataset again, and the admin and client logins have to be created again.
- **Allow time.** The 10× level writes about 333,000 order requests before it measures anything. Start it before the demo, not during it.

Compare `scale-unseen.md` with [`docs/SCALE.md`](../../docs/SCALE.md), Results. On different hardware the milliseconds will differ. What should hold: no request fails, and the inbox, *My orders* and stock-out log slow down far more than the readiness check.
