// Speed and size test: what the API does when order volume grows. Copies the database in DATABASE_URL to a scratch
// database (<name>_scale), fills it with six months of order requests at each volume level, runs the real Express app
// on it and fires concurrent requests at the endpoints whose work grows with orders. The scratch database is dropped
// afterwards; the source database is only read (as the template for the copy).
//   npm run bench:scale                                 1× and 10× today's volume
//   npm run bench:scale -- --levels 1,10,30 --requests 300 --concurrency 20 --out scale.md
//
// Today's volume comes from the dataset: email and API orders a day (EDI isn't stored as a request yet, FR-11).
// Run it on a local or staging database: CREATE DATABASE … TEMPLATE needs no other connection to the source.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { createApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { createContainer } from "../container.js";
import { seedAdmin } from "../services/admin-seed.service.js";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const levels = (arg("levels") ?? "1,10").split(",").map(Number).filter((x) => x > 0);
const requests = Number(arg("requests") ?? 200);
const concurrency = Number(arg("concurrency") ?? 20);
const out = arg("out");
const DAYS = 180;
const ORIGIN = "http://localhost:3000";
// "My orders" reads the newest CLIENT_WINDOW requests of all clients (EmailsController); checked against what exists.
const CLIENT_WINDOW = 500;

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");
const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

// A cookie jar per signed-in user, like the browser's.
class Agent {
  cookies = new Map<string, string>();
  constructor(private readonly base: string) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        origin: ORIGIN,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie()) {
      const [name, value] = raw.split(";")[0].split("=");
      if (value) this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, bytes: text.length };
  }
}

// `requests` calls, `concurrency` at a time; latency percentiles in ms and throughput.
async function load(agent: Agent, path: string) {
  for (let i = 0; i < 5; i++) await agent.req("GET", path);
  const times: number[] = [];
  let failed = 0;
  let bytes = 0;
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        next++;
        const t = performance.now();
        const res = await agent.req("GET", path);
        times.push(performance.now() - t);
        if (res.status !== 200) failed++;
        bytes = res.bytes;
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { p50: p(0.5), p95: p(0.95), p99: p(0.99), rps: times.length / seconds, failed, kb: bytes / 1024 };
}

async function fill(db: Pool, perDay: { email: number; api: number }, level: number) {
  const emails = Math.round(perDay.email * DAYS * level);
  const api = Math.round(perDay.api * DAYS * level);
  // Spread over the last six months; staff have worked 70% of emailed requests and linked them to a client.
  await db.query(
    `INSERT INTO inbound_emails (message_id, mailbox, from_address, subject, snippet, body, received_at, read_by_ai, ai_result, ai_read_at)
     SELECT 'scale-e-' || g, 'orders@halcyon.test', 'Buyer <buyer' || (g % 997) || '@client.test>', 'Order ' || g,
            'Please send 12 cartons', repeat('Please send the following items to our site. ', 20),
            now() - random() * interval '${DAYS} days', true, '{"agent":"scale","output":{}}'::jsonb, now()
     FROM generate_series(1, $1) g`,
    [emails],
  );
  await db.query(
    `WITH c AS (SELECT array_agg(client_id ORDER BY client_id) ids FROM clients)
     INSERT INTO order_requests (request_id, channel, message_id, client_set, client_id, edits, created_at)
     SELECT 'scale-e-' || g, 'email', 'scale-e-' || g, true, c.ids[1 + g % array_length(c.ids, 1)], '{"products":[]}'::jsonb, now()
     FROM generate_series(1, $1) g, c WHERE g % 10 < 7`,
    [emails],
  );
  await db.query(
    `WITH c AS (SELECT array_agg(client_id ORDER BY client_id) ids FROM clients)
     INSERT INTO order_requests (request_id, channel, client_set, client_id, edits, order_payload, created_at)
     SELECT 'scale-a-' || g, 'api', true, c.ids[1 + g % array_length(c.ids, 1)], '{}'::jsonb,
            jsonb_build_object('placedBy', 'Scale <scale@client.test>', 'customer', null, 'reference', 'R' || g, 'notes', null,
              'products', jsonb_build_array(jsonb_build_object('sku', 'SKU-1', 'quantity', 12)),
              'address', '1 Main St', 'suite', null, 'city', 'Chicago', 'state', 'IL', 'postal_code', '60601', 'country', 'US'),
            now() - random() * interval '${DAYS} days'
     FROM generate_series(1, $1) g, c`,
    [api],
  );
  await db.query("ANALYZE");
  return { emails, api };
}

async function main() {
  const admin = new Pool({ connectionString: withDb(sourceUrl!, "postgres") });
  const source = new URL(sourceUrl!).pathname.slice(1);
  const scratch = `${source}_scale`;
  const src = new Pool({ connectionString: sourceUrl });
  const perDay = await (async () => {
    const { rows } = await src.query<{ ch: string; n: string }>(
      `SELECT order_channel ch, count(*)::numeric / count(DISTINCT order_received_ts::date) n FROM deliveries
       WHERE order_channel IN ('Email', 'API') GROUP BY 1`,
    );
    const of = (ch: string) => Number(rows.find((r) => r.ch === ch)?.n ?? 0);
    return { email: of("Email"), api: of("API") };
  })();
  await src.end();

  say("# Halcyon — speed and size test");
  say();
  say(`${new Date().toISOString().slice(0, 10)}. Six months (${DAYS} days) of order requests at each level. Today's volume, from the dataset: ${perDay.email.toFixed(0)} email and ${perDay.api.toFixed(0)} API orders a day (EDI isn't stored as a request yet). ${requests} requests per endpoint, ${concurrency} at a time, through the real Express app (auth, RBAC, validation) on one Node process and a local PostgreSQL. Times in ms.`);

  const results: { level: number; rows: number; size: string; endpoints: [string, Awaited<ReturnType<typeof load>>][]; visible: number; exists: number }[] = [];
  try {
    for (const level of levels) {
      await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
      await admin.query(`CREATE DATABASE ${scratch} TEMPLATE ${source}`);
      const url = withDb(sourceUrl!, scratch);
      const config = loadConfig({ NODE_ENV: "test", CORS_ORIGINS: ORIGIN, DATABASE_URL: url, JWT_SECRET: randomBytes(48).toString("base64") });
      const db = new Pool({ connectionString: url, max: config.databasePoolMax });
      let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
      try {
        const t = performance.now();
        const filled = await fill(db, perDay, level);
        const fillSeconds = (performance.now() - t) / 1000;
        const container = createContainer(config, db);
        // Random, plus a digit and a letter so it always meets the password rules.
        const password = `${randomBytes(12).toString("base64url")}7k`;
        await seedAdmin(container.repositories.staff, { email: "bench@halcyon.test", name: "Bench", password });
        server = createApp(container).listen(0);
        await new Promise((resolve) => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const staff = new Agent(base);
        if ((await staff.req("POST", "/api/auth/staff/login", { email: "bench@halcyon.test", password })).status !== 200) throw new Error("staff login failed");
        const clientId = (await db.query<{ client_id: string }>(`SELECT client_id FROM clients ORDER BY client_id LIMIT 1`)).rows[0].client_id;
        const created = await staff.req("POST", `/api/clients/${clientId}/users`, { email: "bench@client.test", name: "Bench Client", password: "bench-pass-123" });
        if (created.status !== 201) throw new Error(`client user: ${created.status}`);
        const client = new Agent(base);
        if ((await client.req("POST", "/api/auth/client/login", { email: "bench@client.test", password: "bench-pass-123" })).status !== 200) throw new Error("client login failed");

        const endpoints: [string, string, Agent][] = [
          ["Readiness (database ping)", "/ready", staff],
          ["Staff inbox, first page (50)", "/api/emails?limit=50", staff],
          ["Staff inbox, page at 5,000", "/api/emails?limit=50&offset=5000", staff],
          ["Stock-outs, last 30 days", "/api/stockouts?days=30", staff],
          ["Client \"My orders\"", "/api/order-requests", client],
        ];
        const measured: [string, Awaited<ReturnType<typeof load>>][] = [];
        for (const [label, path, agent] of endpoints) measured.push([label, await load(agent, path)]);

        // Does the client see every order of theirs from the last 30 days?
        const mine = await client.req("GET", "/api/order-requests");
        const since = Date.now() - 30 * 86_400_000;
        const visible = (mine.body.emails as { receivedAt: string }[]).filter((e) => new Date(e.receivedAt).getTime() >= since).length;
        const exists = Number(
          (await db.query<{ n: string }>(`SELECT count(*) n FROM order_requests WHERE client_id = $1 AND COALESCE((SELECT received_at FROM inbound_emails e WHERE e.message_id = order_requests.message_id), created_at) >= now() - interval '30 days'`, [clientId])).rows[0].n,
        );
        const size = (await db.query<{ s: string }>(`SELECT pg_size_pretty(pg_database_size(current_database())) s`)).rows[0].s;
        
        results.push({ level, rows: filled.emails + filled.api, size, endpoints: measured, visible, exists });
        console.error(`level ${level}×: filled ${filled.emails + filled.api} requests in ${fillSeconds.toFixed(1)} s`);
      } finally {
        await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
        await db.end();
        await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
      }
    }
  } finally {
    await admin.end();
  }

  say();
  say("| Level | Order requests | Database size |");
  say("|---|---:|---:|");
  for (const r of results) say(`| ${r.level}× | ${r.rows.toLocaleString("en-US")} | ${r.size} |`);
  say();
  say(`| Endpoint | ${results.map((r) => `${r.level}× p50 / p95`).join(" | ")} | ${results.map((r) => `${r.level}× req/s`).join(" | ")} |`);
  say(`|---|${results.map(() => "---:").join("|")}|${results.map(() => "---:").join("|")}|`);
  for (let i = 0; i < results[0].endpoints.length; i++) {
    const [label] = results[0].endpoints[i];
    const cells = results.map((r) => {
      const m = r.endpoints[i][1];
      return `${m.p50.toFixed(0)} / ${m.p95.toFixed(0)}${m.failed ? ` (${m.failed} failed)` : ""}`;
    });
    say(`| ${label} | ${cells.join(" | ")} | ${results.map((r) => r.endpoints[i][1].rps.toFixed(0)).join(" | ")} |`);
  }
  say();
  say(`"My orders" returns up to ${CLIENT_WINDOW} requests. A client should see every one of theirs from the last 30 days:`);
  say();
  say("| Level | Client's orders in the last 30 days | Shown on \"My orders\" |");
  say("|---|---:|---:|");
  for (const r of results) say(`| ${r.level}× | ${r.exists} | ${r.visible}${r.visible < Math.min(r.exists, CLIENT_WINDOW) ? " (some missing)" : ""} |`);
}

await main();
if (out) {
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`\nWrote ${out}`);
}
