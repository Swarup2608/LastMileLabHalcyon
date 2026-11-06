# Halcyon: reuse, speed and size

Two questions: what it takes to run Halcyon for another client or another warehouse network ([Reuse](#reuse)), and what happens to the API when order volume grows ten times. The second was measured on 30 October 2026 with `npm run bench:scale` ([`api/src/sim/scale.ts`](../api/src/sim/scale.ts)).

## How it was measured

- **Data.** A scratch copy of the database (dropped afterwards), filled with six months of order requests at each level. Today's volume comes from the dataset: 86 email and 99 API orders a day. EDI orders aren't stored as requests yet (FR-11), so they're not counted.
- **Load.** 200 requests per endpoint, 20 at a time, through the real Express app: sign-in, role checks and validation included. One Node process and one local PostgreSQL 17 container on a laptop.
- **Not measured.** The browser, the Next.js `/api` proxy, network latency, and Azure hardware. Read the numbers as relative (1× against 10×), not as production response times.

```bash
cd api && DATABASE_URL=postgres://… npm run bench:scale -- --levels 1,10
```

Run it against a local or staging database only. It needs no other connection to the source database while it copies it.

## Results

| Level | Order requests | Database size |
|---|---:|---:|
| 1× (today) | 33,312 | 100 MB |
| 10× | 333,122 | 342 MB |

Response time in milliseconds (median / 95th percentile), and requests per second:

| Endpoint | 1× p50 / p95 | 10× p50 / p95 | 1× req/s | 10× req/s |
|---|---:|---:|---:|---:|
| Readiness (database ping) | 5 / 19 | 3 / 32 | 3,002 | 2,742 |
| Staff inbox, first page (50) | 98 / 125 | 1,624 / 2,427 | 194 | 12 |
| Staff inbox, page at 5,000 | 166 / 221 | 7,911 / 16,784 | 112 | 2 |
| Stock-outs, last 30 days | 410 / 521 | 3,550 / 4,460 | 48 | 5 |
| Client "My orders" | 124 / 167 | 3,264 / 4,834 | 158 | 6 |

No request failed at either level.

Does each client see all their own orders? Before the R-17 fix, a client with 13 orders in the last 30 days saw none of them, because the list read the newest 500 requests of all clients. After the fix:

| Level | Client's orders in the last 30 days | Shown on "My orders" |
|---|---:|---:|
| 1× | 23 | 23 |
| 10× | 216 | 216 |

## What happens at 10×

**It keeps working, correctly, but the order screens slow down by 15 to 30 times.** At today's volume every screen answers in about a tenth of a second. At 10× the staff inbox takes about 1.6 seconds, and *My orders* and the stock-out log 3 to 3.5 seconds, with 20 people using them at once.

The database isn't the limit: each query on its own still takes about 0.1 s at 10× (checked with `EXPLAIN ANALYZE`). The time goes on how the queries read data:

| Screen | Why it slows | Fix |
|---|---|---|
| Staff inbox | Emails and API orders are joined into one list, then sorted to find the newest 50. Postgres reads and sorts every request, every time. The page also counts every request on each load. A deep page (`offset 5000`) reads 5,000 rows to skip them | Sort and limit each half (emails, API orders) on its own before joining, with an index on API orders' `created_at`. Count from a cached or estimated total. Page by date (`received_at < last seen`) rather than offset |
| *My orders* | Unlinked emails are matched to the client by searching every email body for the client's login addresses, with no index | Store the client when the email arrives (also the fix for security findings R-01 and R-02), then it's an indexed lookup on `client_id` |
| Stock-out log | Each call loads every request from the last 30 days into Node to check for decisions not yet logged | Select only requests with a saved routing or stock decision and no log entry, in SQL |
| Everything | 20 concurrent requests on one Node process | More than one API instance on App Service (needs `REDIS_URL` for shared login limits) |

What isn't covered here, and needs numbers from the business before anyone claims 10× fits ([`DISCOVERY.md`](DISCOVERY.md), A7): warehouse pick-and-pack capacity and carrier capacity. Ten times the orders is ten times the cartons; the software is the smaller problem.

## Reuse

Most of what changes between one operator and the next is settings or data. The four US regions are the exception: they're written into the code.

### Config, data and code

| What | Kind | Where it lives | How to change it |
|---|---|---|---|
| Same-day cutoff and its time zone | Config | `app_settings`, key `delivery` ([`08_settings.sql`](../db/init/08_settings.sql)) | Admin, **Account** page in the portal (`PUT /api/settings/delivery`). Takes effect at once |
| Client companies and their logins | Config | `clients`, `client_users` | Admin, **Users › Clients** in the portal (`POST /api/clients`, `/api/clients/:id/users`) |
| Staff | Config | `staff` | Admin, **Users › Staff** in the portal |
| Agent instructions and models | Config | Azure AI Foundry, found by `FOUNDRY_*_AGENT_NAME` | Edit the agent in Foundry. No redeploy |
| Integrations: Gmail inbox, Foundry, SMTP, Redis, stock transfer delay | Config | App Service settings ([`api/.env.example`](../api/.env.example)) | Change the setting and restart. No rebuild. [`env.ts`](../api/src/config/env.ts) refuses to start on a half-set feature |
| Warehouses and their distance to each region | Data | `warehouses`, `warehouse_region_distance` | SQL. No screen or API route writes them |
| Carriers | Data | `carriers` | SQL. Late rates per region come from `refresh_carrier_performance()` over `deliveries`, so a new carrier has no rate (null) until it has deliveries |
| Products and stock | Data | `products` (each owned by one client), `warehouse_products` | SQL. Products are read-only in the API |
| Delivery history | Data | `deliveries` | SQL or CSV. The carrier ranking and `npm run sim:week` are built from it |
| Regions: Midwest, Northeast, Southeast, West | Code | [`utils/regions.ts`](../api/src/utils/regions.ts) (US state and ZIP → region), [`request-address.ts`](../api/src/utils/request-address.ts), [`clients.schema.ts`](../api/src/schemas/clients.schema.ts), [`simulation.schema.ts`](../api/src/schemas/simulation.schema.ts), [`carrier-plan.service.ts`](../api/src/services/carrier-plan.service.ts), [`sim/week.ts`](../api/src/sim/week.ts), and one column per region in `warehouse_region_distance` ([`01_schema.sql`](../db/init/01_schema.sql)) and `carrier_performance` ([`09_carrier_performance.sql`](../db/init/09_carrier_performance.sql)) | Code change and deploy. Turn the two wide tables into `(warehouse_id, region, miles)` and `(carrier_id, region, late_pct)` rows first, then read the region list from the database |
| One cutoff for the whole network | Code | `warehouses.pick_list_cutoff` is loaded but not used | Code change, if warehouses close their pick lists at different times |
| One operator per deployment | Design | One database, one Gmail inbox, one set of agents | A second operator gets its own deployment, not a tenant in this one |

### Onboarding another client

Same warehouse network, a new client company. No code and no deploy.

1. An admin opens **Users › Clients** and adds the company: name, region, order channel, tier, SLA clause and a first contact login.
2. The admin adds any more logins for the company. An email is linked to a client by its sender, or else by a client login written in the body ([`matchClient`](../api/src/repositories/email.repository.ts)), so the people who send orders need a login.
3. Load the client's products, and stock for them in at least one warehouse, with SQL. Until then the client's **New order** page says "No products are stocked with Halcyon for your account yet, so there is nothing to order." For a demo only, re-running [`07_client_products.sql`](../db/init/07_client_products.sql) gives every client with fewer than 6 products synthetic ones with stock.
4. The client signs in and orders through the portal or by email. Same-day cutoff, address checks and warehouse routing apply from the first order.

### Onboarding another warehouse network

A different operator, or Halcyon with a new set of warehouses and carriers.

1. **Deploy a copy:** a PostgreSQL database, two App Services, a Gmail inbox and the Foundry agents ([`SETUP.md`](SETUP.md), [README › Deployment](../README.md#-deployment)).
2. **Replace the data** in [`db/data/`](../db/data/) before the first start, in the same columns ([`DATA_DICTIONARY.md`](../db/data/DATA_DICTIONARY.md)): `warehouses.csv`, `warehouse_region_distance_miles.csv`, `carriers.csv`, `clients.csv`, and `deliveries.csv` for history. The init scripts only run on an empty database.
3. **Replace the synthetic products and stock.** [`03_products.sql`](../db/init/03_products.sql), [`04_warehouse_products.sql`](../db/init/04_warehouse_products.sql) and [`07_client_products.sql`](../db/init/07_client_products.sql) generate them because the dataset has none. Load the operator's catalogue and stock levels instead.
4. **Set the cutoff and time zone** on the **Account** page, and create the first admin with `npm run admin:create`.
5. **Regions.** If the network covers other regions, or another country, change the code listed under Regions above. This is the only step that needs a developer.
6. **Check against history.** Run `npm run sim:week`. The "before" run must match the network's real on-time rate within 3 points, or the run fails and the before/after figures shouldn't be quoted. Without delivery history there is no carrier ranking and nothing to compare.

## Earlier run

The first run on 30 October failed about half the 10× requests with Postgres `dsm_impl_posix` errors. That came from Docker's default 64 MB shared memory, not from the app; the container now runs with `--shm-size=1g`. The same run found the *My orders* bug (R-17), since fixed.
