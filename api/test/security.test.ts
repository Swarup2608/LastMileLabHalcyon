// Security audit tests: the RBAC matrix for every route and role, plus attack probes. Runs against an in-memory
// Postgres (pg-mem); never touches DATABASE_URL or .env. Tests marked `todo` assert the secure behaviour for a gap
// found in a security audit: they report as failing todos (without failing the suite) until the gap is fixed.
import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { SignJWT } from "jose";
import { newDb } from "pg-mem";
import { StockTransferService } from "../src/services/stock-transfer.service.js";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createContainer } from "../src/container.js";
import { accountRateLimit, clientIpKey, loginRateLimit } from "../src/middleware/rate-limit.js";
import { RetentionService } from "../src/services/retention.service.js";
import { seedAdmin } from "../src/services/admin-seed.service.js";
import { matchClient } from "../src/repositories/email.repository.js";
import type { Mailer, OutgoingMail } from "../src/utils/mailer.js";

const ORIGIN = "http://localhost:3000";
const ADMIN = { email: "admin@halcyon.test", password: "admin-pass-123", name: "Test Admin" };
const SECRET = "test-secret-that-is-long-enough-for-hs256-0123456789";

const config = loadConfig({
  NODE_ENV: "test",
  CORS_ORIGINS: ORIGIN,
  DATABASE_URL: "pg-mem",
  JWT_SECRET: SECRET,
});

let base = "";
let close = () => {};
let container: ReturnType<typeof createContainer>;

before(async () => {
  const mem = newDb();
  mem.public.none(`
    CREATE TABLE clients (client_id TEXT PRIMARY KEY, client_name TEXT, region TEXT, primary_order_channel TEXT,
      account_tier TEXT, sla_penalty_clause CHAR(1), annual_revenue_usd NUMERIC, account_status TEXT);
    INSERT INTO clients VALUES ('C001', 'Client 001', 'Northeast', 'Email', 'Tier 2', 'N', 446000, 'active');
    INSERT INTO clients VALUES ('C002', 'Client 002', 'Northeast', 'API', 'Tier 3', 'Y', 191000, 'active');
    CREATE TABLE warehouses (warehouse_id TEXT PRIMARY KEY, warehouse_name TEXT, region TEXT, pick_list_cutoff TEXT,
      carrier_collection_window TEXT);
    CREATE TABLE warehouse_region_distance (warehouse_id TEXT PRIMARY KEY, midwest INT, southeast INT, northeast INT,
      west INT);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, sku TEXT, product_name TEXT, category TEXT, client_id TEXT,
      unit_price_usd NUMERIC, unit_weight_kg NUMERIC);
    CREATE TABLE warehouse_products (warehouse_id TEXT, product_id TEXT, quantity_on_hand INT, quantity_reserved INT,
      reorder_point INT, bin_location TEXT, updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (warehouse_id, product_id));`);
  mem.public.none(readFileSync(new URL("../../db/init/02_auth.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/05_inbound_emails.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/06_order_requests.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/13_ignored_orders.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/08_settings.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/10_carrier_plans.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/11_stockout_events.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/12_stock_transfers.sql", import.meta.url), "utf8"));
  const { Pool: MemPool } = mem.adapters.createPg();
  container = createContainer(config, new MemPool() as Pool);
  await seedAdmin(container.repositories.staff, ADMIN);

  const server = createApp(container).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => close());

// Minimal cookie jar: keeps name=value pairs from Set-Cookie, drops cleared ones.
class Agent {
  cookies = new Map<string, string>();

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        origin: ORIGIN,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const [name, value] = pair.split("=");
      if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

const login = async (realm: "staff" | "client", email: string, password: string) => {
  const agent = new Agent();
  const res = await agent.req("POST", `/api/auth/${realm}/login`, { email, password });
  assert.equal(res.status, 200, `login ${email}`);
  return { agent, user: res.body.user };
};

const adminAgent = async () => (await login("staff", ADMIN.email, ADMIN.password)).agent;

let seq = 0;
async function newStaff(role: "admin" | "contributor") {
  const admin = await adminAgent();
  const email = `${role}${++seq}@halcyon.test`;
  const created = await admin.req("POST", "/api/staff", { email, name: `${role} ${seq}`, role });
  assert.equal(created.status, 201);
  return { id: created.body.staff.id as string, ...(await login("staff", email, created.body.temporaryPassword)) };
}

async function newClientUser(clientId: string) {
  const admin = await adminAgent();
  const email = `user${++seq}@${clientId.toLowerCase()}.test`;
  const created = await admin.req("POST", `/api/clients/${clientId}/users`, { email, name: "Client User", password: "client-pass-123" });
  assert.equal(created.status, 201);
  return { id: created.body.user.id as string, ...(await login("client", email, "client-pass-123")) };
}

describe("RBAC matrix", () => {
  // Expected status per role; any 2xx/4xx other than 401/403 means the guard let the request through to validation.
  const ALLOWED = "allowed";
  type Expect = 400 | 401 | 403 | 404 | 503 | typeof ALLOWED;
  const routes: { method: string; path: string; body?: unknown; anon: Expect; client: Expect; contributor: Expect; admin: Expect }[] = [
    { method: "GET", path: "/api/staff", anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    { method: "POST", path: "/api/staff", body: {}, anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    { method: "GET", path: "/api/staff/00000000-0000-4000-8000-000000000000", anon: 401, client: 403, contributor: 403, admin: 404 },
    { method: "PATCH", path: "/api/staff/00000000-0000-4000-8000-000000000000", body: { name: "x" }, anon: 401, client: 403, contributor: 403, admin: 404 },
    { method: "PATCH", path: "/api/staff/00000000-0000-4000-8000-000000000000/demo", body: { isDemo: true }, anon: 401, client: 403, contributor: 403, admin: 404 },
    { method: "GET", path: "/api/clients", anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "POST", path: "/api/clients", body: {}, anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    { method: "GET", path: "/api/clients/C002", anon: 401, client: 404, contributor: ALLOWED, admin: ALLOWED },
    { method: "GET", path: "/api/clients/C001/users", anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    { method: "POST", path: "/api/clients/C001/users", body: {}, anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    { method: "PATCH", path: "/api/clients/C001/users/00000000-0000-4000-8000-000000000000", body: { name: "x" }, anon: 401, client: 403, contributor: 403, admin: 404 },
    { method: "PATCH", path: "/api/clients/C001/users/00000000-0000-4000-8000-000000000000/demo", body: { isDemo: true }, anon: 401, client: 403, contributor: 403, admin: 404 },
    { method: "GET", path: "/api/warehouses", anon: 401, client: ALLOWED, contributor: ALLOWED, admin: ALLOWED },
    { method: "GET", path: "/api/products", anon: 401, client: ALLOWED, contributor: ALLOWED, admin: ALLOWED },
    { method: "GET", path: "/api/emails", anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "PUT", path: "/api/emails/nope/request", body: { edits: {} }, anon: 401, client: 403, contributor: 404, admin: 404 },
    { method: "PUT", path: "/api/emails/nope/ignored", body: { ignore: true }, anon: 401, client: 403, contributor: 404, admin: 404 },
    { method: "GET", path: "/api/order-requests", anon: 401, client: ALLOWED, contributor: 403, admin: 403 },
    { method: "POST", path: "/api/order-requests/nope/answers", body: {}, anon: 401, client: 404, contributor: 403, admin: 403 },
    { method: "POST", path: "/api/order-requests", body: {}, anon: 401, client: ALLOWED, contributor: 403, admin: 403 },
    { method: "GET", path: "/api/order-requests/email", anon: 401, client: ALLOWED, contributor: 403, admin: 403 },
    { method: "POST", path: "/api/order-requests/email", body: {}, anon: 401, client: ALLOWED, contributor: 403, admin: 403 },
    { method: "POST", path: "/api/order-requests/nope/stock-flag", body: { decision: "accept" }, anon: 401, client: 404, contributor: 403, admin: 403 },
    { method: "POST", path: "/api/emails/nope/stock-flag/draft", body: {}, anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "GET", path: "/api/carrier-plan", anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "POST", path: "/api/carrier-plan/run", body: {}, anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "PUT", path: "/api/carrier-plan/carrier", body: { orderId: "REQ-1", carrier: "A" }, anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "POST", path: "/api/carrier-plan/assign", body: {}, anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "GET", path: "/api/settings", anon: 401, client: ALLOWED, contributor: ALLOWED, admin: ALLOWED },
    { method: "PUT", path: "/api/settings/delivery", body: {}, anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    // FOUNDRY_* are not set in tests, so staff get 503.
    { method: "POST", path: "/api/emails/analyze", anon: 401, client: 403, contributor: 503, admin: 503 },
    { method: "POST", path: "/api/rebalance/suggest", body: {}, anon: 401, client: 403, contributor: 503, admin: 503 },
    { method: "GET", path: "/api/stockouts", anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    { method: "POST", path: "/api/rebalance/apply", body: {}, anon: 401, client: 403, contributor: 400, admin: 400 },
    { method: "GET", path: "/api/rebalance/transfers", anon: 401, client: 403, contributor: ALLOWED, admin: ALLOWED },
    // The Simulation is admins only.
    { method: "GET", path: "/api/simulation", anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    { method: "POST", path: "/api/simulation/carrier", body: {}, anon: 401, client: 403, contributor: 403, admin: ALLOWED },
    // Removed (SEC-12): the database endpoints no longer exist for anyone.
    { method: "GET", path: "/api/admin/db/tables", anon: 404, client: 404, contributor: 404, admin: 404 },
    { method: "POST", path: "/api/admin/db/migrate", anon: 404, client: 404, contributor: 404, admin: 404 },
    { method: "POST", path: "/api/admin/db/seed/clients", anon: 404, client: 404, contributor: 404, admin: 404 },
  ];

  test("every route enforces its role for anonymous, client, contributor and admin", async () => {
    const agents = {
      anon: new Agent(),
      client: (await newClientUser("C001")).agent,
      contributor: (await newStaff("contributor")).agent,
      admin: await adminAgent(),
    };
    const failures: string[] = [];
    for (const route of routes) {
      for (const role of ["anon", "client", "contributor", "admin"] as const) {
        const { status } = await agents[role].req(route.method, route.path, route.body);
        const expected = route[role];
        const ok = expected === ALLOWED ? status !== 401 && status !== 403 : status === expected;
        if (!ok) failures.push(`${role} ${route.method} ${route.path}: got ${status}, expected ${expected}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test("each realm's auth routes reject the other realm's session", async () => {
    const client = (await newClientUser("C001")).agent;
    const staff = (await newStaff("contributor")).agent;
    assert.equal((await client.req("GET", "/api/auth/staff/me")).status, 403);
    assert.equal((await staff.req("GET", "/api/auth/client/me")).status, 403);
    assert.equal((await client.req("PATCH", "/api/auth/staff/me", { name: "x" })).status, 403);
    assert.equal((await staff.req("PATCH", "/api/auth/client/me", { name: "x" })).status, 403);
    // A client refresh cookie presented to the staff refresh route.
    assert.equal((await client.req("POST", "/api/auth/staff/refresh")).status, 401);
  });
});

describe("privilege escalation and IDOR", () => {
  test("own-account update can't set role, isActive, clientId or isDemo", async () => {
    const { agent } = await newStaff("contributor");
    for (const field of [{ role: "admin" }, { isActive: true }, { isDemo: false }, { clientId: "C002" }]) {
      assert.equal((await agent.req("PATCH", "/api/auth/staff/me", { name: "x", ...field })).status, 400, JSON.stringify(field));
    }
    const client = (await newClientUser("C001")).agent;
    assert.equal((await client.req("PATCH", "/api/auth/client/me", { name: "x", clientId: "C002" })).status, 400);
  });

  test("an admin can't edit a client user through another client's path", async () => {
    const victim = await newClientUser("C001");
    const admin = await adminAgent();
    assert.equal((await admin.req("PATCH", `/api/clients/C002/users/${victim.id}`, { isActive: false })).status, 404);
    assert.equal((await admin.req("PATCH", `/api/clients/C002/users/${victim.id}/demo`, { isDemo: true })).status, 404);
    assert.equal((await victim.agent.req("GET", "/api/auth/client/me")).status, 200);
  });

  test("client responses never include password hashes or demo passwords", async () => {
    const admin = await adminAgent();
    const users = await admin.req("GET", "/api/clients/C001/users");
    const staff = await admin.req("GET", "/api/staff");
    const text = JSON.stringify([users.body, staff.body]);
    assert.doesNotMatch(text, /scrypt\$|password_hash|passwordHash|demo_password|demoPassword/);
  });
});

describe("token forgery", () => {
  const sign = (claims: Record<string, unknown>, secret = SECRET, alg = "HS256") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg })
      .setSubject("00000000-0000-4000-8000-000000000000")
      .setIssuer("halcyon-api")
      .setAudience("halcyon:access")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));

  const withToken = (token: string) => {
    const agent = new Agent();
    agent.cookies.set("halcyon_at", token);
    return agent;
  };

  test("alg=none, wrong secret, wrong audience and expired tokens are all rejected", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${enc({ alg: "none", typ: "JWT" })}.${enc({
      sub: "x", typ: "staff", role: "admin", iss: "halcyon-api", aud: "halcyon:access", exp: 9999999999,
    })}.`;
    assert.equal((await withToken(none).req("GET", "/api/staff")).status, 401);
    assert.equal((await withToken(await sign({ typ: "staff", role: "admin" }, "x".repeat(40))).req("GET", "/api/staff")).status, 401);
    assert.equal((await withToken(await sign({ typ: "staff", role: "admin" }, SECRET, "HS512")).req("GET", "/api/staff")).status, 401);

    const expired = await new SignJWT({ typ: "staff", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("x")
      .setIssuer("halcyon-api")
      .setAudience("halcyon:access")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    assert.equal((await withToken(expired).req("GET", "/api/staff")).status, 401);
  });

  test("a client token claiming another clientId can't be minted without the secret", async () => {
    const client = await newClientUser("C001");
    const [h, p, s] = client.agent.cookies.get("halcyon_at")!.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, clientId: "C002" })).toString("base64url")}.${s}`;
    assert.equal((await withToken(forged).req("GET", "/api/clients/C002")).status, 401);
  });
});

describe("csrf", () => {
  test("writes with Origin: null or a look-alike origin are refused", async () => {
    const agent = await adminAgent();
    for (const origin of ["null", "http://localhost:3000.evil.test", "http://evil.test"]) {
      const res = await agent.req("POST", "/api/staff", { email: "csrf@halcyon.test", name: "x", role: "admin" }, { origin });
      assert.equal(res.status, 403, origin);
    }
  });
});

describe("rate limiting (SEC-03)", () => {
  test("client IPs are counted without Azure's port, and IPv6 by subnet", () => {
    assert.equal(clientIpKey("203.0.113.7:56789"), clientIpKey("203.0.113.7"));
    assert.equal(clientIpKey("203.0.113.7:1"), clientIpKey("203.0.113.7:2"));
    assert.equal(clientIpKey("[2001:db8::1]:443"), clientIpKey("2001:db8::2"));
    assert.notEqual(clientIpKey("203.0.113.7"), clientIpKey("203.0.113.8"));
  });

  const limitedApp = async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/login", loginRateLimit(), accountRateLimit(), (_req, res) => {
      res.status(401).end();
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/login` };
  };
  const attempt = (url: string, ip: string, email: string) =>
    fetch(url, { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify({ email }) });

  test("one account guessed from many IPs is still limited", async () => {
    const { server, url } = await limitedApp();
    try {
      for (let i = 0; i < 10; i++) assert.equal((await attempt(url, `198.51.100.${i}`, "Target@Halcyon.test")).status, 401);
      assert.equal((await attempt(url, "198.51.100.99", "target@halcyon.test ")).status, 429);
      assert.equal((await attempt(url, "198.51.100.99", "someone-else@halcyon.test")).status, 401);
    } finally {
      server.close();
    }
  });

  test("one IP rotating its port is still limited", async () => {
    const { server, url } = await limitedApp();
    try {
      for (let i = 0; i < 10; i++) assert.equal((await attempt(url, `203.0.113.7:${40000 + i}`, `u${i}@halcyon.test`)).status, 401);
      assert.equal((await attempt(url, "203.0.113.7:50000", "fresh@halcyon.test")).status, 429);
    } finally {
      server.close();
    }
  });
});

describe("audit log (SEC-07)", () => {
  type Entry = {
    actor: { type: string; id: string; role: string } | null;
    action: string;
    outcome: string;
    target: { type: string; id: string } | null;
    details: Record<string, unknown> | null;
    ip: string | null;
  };
  const entries = async (admin: Agent, query: string) => {
    const res = await admin.req("GET", `/api/audit?limit=200&${query}`);
    assert.equal(res.status, 200);
    return res.body.entries as Entry[];
  };

  test("admin actions are recorded with actor, target and changes, never a password", async () => {
    const { agent: admin, user: adminUser } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/staff", { email: "audited@halcyon.test", name: "Audited", role: "contributor" });
    const id = created.body.staff.id;
    await admin.req("PATCH", `/api/staff/${id}`, { role: "admin", password: "reset-pass-12345" });
    await admin.req("PATCH", `/api/staff/${id}/demo`, { isDemo: true });

    const trail = await entries(admin, `targetId=${id}`);
    const byAction = (action: string) => trail.find((e) => e.action === action)!;
    assert.deepEqual(byAction("staff.create").actor, { type: "staff", id: adminUser.id, role: "admin" });
    assert.deepEqual(byAction("staff.create").details, { email: "audited@halcyon.test", name: "Audited", role: "contributor" });
    assert.deepEqual(byAction("staff.update").details, { role: "admin", passwordReset: true });
    assert.deepEqual(byAction("staff.demo").details, { isDemo: true });
    assert.ok(trail.every((e) => e.outcome === "success" && e.ip));

    const everything = JSON.stringify(await entries(admin, ""));
    for (const secret of ["reset-pass-12345", created.body.temporaryPassword, ADMIN.password, "client-pass-123"]) {
      assert.ok(!everything.includes(secret), "audit log must never hold a password");
    }
  });

  test("sign-ins, failed sign-ins and sign-outs are recorded", async () => {
    const client = await newClientUser("C001");
    await new Agent().req("POST", "/api/auth/client/login", { email: client.user.email, password: "wrong-guess-123" });
    await client.agent.req("POST", "/api/auth/client/logout");

    const admin = await adminAgent();
    const own = await entries(admin, `actorId=${client.id}`);
    assert.ok(own.some((e) => e.action === "auth.login" && e.outcome === "success"));
    assert.ok(own.some((e) => e.action === "auth.logout"));
    const failed = (await entries(admin, "action=auth.login&outcome=failure")).find((e) => e.details?.email === client.user.email)!;
    assert.equal(failed.actor, null);
    assert.equal(JSON.stringify(failed).includes("wrong-guess-123"), false);
  });

  test("contributor and client reads, account changes and refused requests are recorded", async () => {
    const contributor = await newStaff("contributor");
    await contributor.agent.req("GET", "/api/clients/C002");
    await contributor.agent.req("GET", "/api/staff");
    const client = await newClientUser("C002");
    await client.agent.req("GET", "/api/clients/C002");
    await client.agent.req("PATCH", "/api/auth/client/me", { name: "Renamed" });
    await client.agent.req("PATCH", "/api/auth/client/me", { email: "x@c002.test", currentPassword: "not-my-password-1" });

    const admin = await adminAgent();
    const byContributor = await entries(admin, `actorId=${contributor.id}`);
    assert.ok(byContributor.some((e) => e.action === "client.view" && e.target?.id === "C002"));
    const denied = byContributor.find((e) => e.action === "access.denied")!;
    assert.deepEqual(denied.details, { method: "GET", path: "/api/staff" });
    assert.equal(denied.actor?.role, "contributor");

    const byClient = await entries(admin, `actorId=${client.id}`);
    assert.ok(byClient.some((e) => e.action === "client.view" && e.target?.id === "C002"));
    assert.ok(byClient.some((e) => e.action === "account.update" && e.outcome === "success"));
    const wrongPassword = byClient.find((e) => e.action === "account.update" && e.outcome === "failure")!;
    assert.equal(wrongPassword.details?.reason, "Current password is incorrect");
    // Logged once under its own action, not again as access.denied.
    assert.equal(byClient.filter((e) => e.action === "access.denied").length, 0);
  });

  test("a replayed refresh token is recorded as reuse", async () => {
    const client = await newClientUser("C001");
    const thief = new Agent();
    thief.cookies.set("halcyon_rt", client.agent.cookies.get("halcyon_rt")!);
    await client.agent.req("POST", "/api/auth/client/logout");
    assert.equal((await thief.req("POST", "/api/auth/client/refresh")).status, 401);
    const admin = await adminAgent();
    assert.ok((await entries(admin, `actorId=${client.id}`)).some((e) => e.action === "auth.refresh_reuse" && e.outcome === "failure"));
  });

  test("only admins read the audit log", async () => {
    assert.equal((await new Agent().req("GET", "/api/audit")).status, 401);
    assert.equal((await (await newStaff("contributor")).agent.req("GET", "/api/audit")).status, 403);
    assert.equal((await (await newClientUser("C001")).agent.req("GET", "/api/audit")).status, 403);
  });
});

describe("caching (SEC-10)", () => {
  test("every API response is marked no-store", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    for (const path of ["/api/staff", "/api/clients", "/api/clients/C001/users", "/api/audit", "/api/warehouses", "/api/nope"]) {
      const res = await fetch(base + path, { headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
      assert.equal(res.headers.get("cache-control"), "no-store", path);
    }
  });
});

describe("password hashing", () => {
  const hashOf = async (email: string) =>
    (await container.repositories.staff.findByEmail(email))!.password_hash;

  test("passwords are stored as argon2id", async () => {
    const member = await newStaff("contributor");
    assert.match(await hashOf(member.user.email), /^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
  });

  test("an account still on an old scrypt hash signs in, and its hash is upgraded to argon2id", async () => {
    const member = await newStaff("contributor");
    const salt = randomBytes(16);
    const legacy = ["scrypt", 2 ** 15, 8, 1, salt.toString("base64url"),
      scryptSync("legacy-pass-123", salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")].join("$");
    await container.repositories.staff.updateAccount(member.id, { passwordHash: legacy });

    assert.equal((await new Agent().req("POST", "/api/auth/staff/login", { email: member.user.email, password: "wrong-pass-123" })).status, 401);
    assert.equal(await hashOf(member.user.email), legacy, "a wrong password never triggers the upgrade");
    await login("staff", member.user.email, "legacy-pass-123");
    assert.match(await hashOf(member.user.email), /^\$argon2id\$/);
    await login("staff", member.user.email, "legacy-pass-123");
  });

  test("the password rules still apply to every way of setting one", async () => {
    const admin = await adminAgent();
    const member = await newStaff("contributor");
    const client = await newClientUser("C001");
    for (const weak of ["short1", "no-digits-here", "1234567890", "x".repeat(250) + "1234567"]) {
      assert.equal((await admin.req("PATCH", `/api/staff/${member.id}`, { password: weak })).status, 400, weak);
      assert.equal((await admin.req("PATCH", `/api/clients/C001/users/${client.id}`, { password: weak })).status, 400, weak);
      assert.equal((await admin.req("POST", "/api/clients/C001/users", { email: "w@c.test", name: "W", password: weak })).status, 400, weak);
      assert.equal((await client.agent.req("PATCH", "/api/auth/client/me", { currentPassword: "client-pass-123", newPassword: weak })).status, 400, weak);
    }
  });
});

describe("retention (SEC-08)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const insertSession = async (expiresDaysAgo: number, revoked: boolean) => {
    const id = randomUUID();
    const expires = new Date(Date.now() - expiresDaysAgo * DAY);
    await container.db.query(
      `INSERT INTO auth_sessions (session_id, family_id, principal_type, principal_id, expires_at, revoked_at)
       VALUES ($1, $2, 'staff', $3, $4, $5)`,
      [id, randomUUID(), randomUUID(), expires, revoked ? new Date(expires.getTime() - DAY) : null],
    );
    return id;
  };
  const sessionExists = async (id: string) =>
    Boolean((await container.db.query(`SELECT 1 FROM auth_sessions WHERE session_id = $1`, [id])).rowCount);

  test("sessions are deleted 30 days after they expire, never just for being revoked", async () => {
    const old = await insertSession(31, false);
    const oldRevoked = await insertSession(45, true);
    const recentlyExpired = await insertSession(5, true);
    const live = await insertSession(-3, true);

    const { sessions } = await container.services.retention.run();
    assert.ok(sessions >= 2);
    assert.equal(await sessionExists(old), false);
    assert.equal(await sessionExists(oldRevoked), false);
    assert.equal(await sessionExists(recentlyExpired), true);
    assert.equal(await sessionExists(live), true, "a revoked but unexpired row is kept, so a replay is still caught");
  });

  test("audit rows older than the retention period are deleted; 0 keeps them forever", async () => {
    const insertAudit = async (daysAgo: number) => {
      const id = randomUUID();
      await container.db.query(
        `INSERT INTO audit_log (audit_id, occurred_at, action, outcome) VALUES ($1, $2, 'auth.login', 'success')`,
        [id, new Date(Date.now() - daysAgo * DAY)],
      );
      return id;
    };
    const exists = async (id: string) =>
      Boolean((await container.db.query(`SELECT 1 FROM audit_log WHERE audit_id = $1`, [id])).rowCount);
    const ancient = await insertAudit(400);
    const recent = await insertAudit(100);

    const keepForever = new RetentionService(container.repositories.sessions, container.repositories.audit, {
      sessionRetentionDays: 30,
      auditRetentionDays: 0,
    });
    assert.equal((await keepForever.run()).audit, 0);
    assert.equal(await exists(ancient), true);

    await container.services.retention.run();
    assert.equal(await exists(ancient), false);
    assert.equal(await exists(recent), true);
  });
});

describe("demo admins (SEC-01)", () => {
  test("an admin made a demo account can't create or promote admins, but still works as an admin", async () => {
    const target = await newStaff("admin");
    const admin = await adminAgent();
    assert.equal((await admin.req("PATCH", `/api/staff/${target.id}/demo`, { isDemo: true })).status, 200);

    const listed = await new Agent().req("GET", "/api/auth/demo-accounts");
    const creds = listed.body.accounts.find((a: { email: string }) => a.email === target.user.email);
    assert.ok(creds, "demo admin is listed publicly with its password");
    const { agent: anon } = await login("staff", creds.email, creds.password);

    const escalated = await anon.req("POST", "/api/staff", { email: "backdoor@halcyon.test", name: "Backdoor", role: "admin" });
    assert.equal(escalated.status, 403, "a public demo login must not create admins");
    const helper = await anon.req("POST", "/api/staff", { email: `helper${++seq}@halcyon.test`, name: "Helper", role: "contributor" });
    assert.equal(helper.status, 201, "a demo admin can still add contributors");
    const promoted = await anon.req("PATCH", `/api/staff/${helper.body.staff.id}`, { role: "admin" });
    assert.equal(promoted.status, 403, "a public demo login must not promote anyone to admin");
    assert.equal((await anon.req("GET", "/api/staff")).status, 200, "a demo admin can still see the staff list");

    // Once demo is off, the same account can create admins again.
    const off = await admin.req("PATCH", `/api/staff/${target.id}/demo`, { isDemo: false });
    assert.equal(off.status, 200);
    const { agent: fresh } = await login("staff", target.user.email, off.body.temporaryPassword);
    const allowed = await fresh.req("PATCH", `/api/staff/${helper.body.staff.id}`, { role: "admin" });
    assert.equal(allowed.status, 200);
  });
});

describe("first admin (SEC-05)", () => {
  test("admin:create's seed promotes an existing demo account, takes it off the demo list and ends its sessions", async () => {
    const member = await newStaff("contributor");
    const admin = await adminAgent();
    assert.equal((await admin.req("PATCH", `/api/staff/${member.id}/demo`, { isDemo: true })).status, 200);

    const password = "seeded-pass-123";
    const id = await seedAdmin(container.repositories.staff, { email: member.user.email, name: "Seeded", password });
    assert.equal(id, member.id);
    await container.repositories.sessions.revokeAllFor("staff", id);

    const listed = await new Agent().req("GET", "/api/auth/demo-accounts");
    assert.ok(!listed.body.accounts.some((a: { email: string }) => a.email === member.user.email));
    assert.equal((await member.agent.req("GET", "/api/staff")).status, 401);
    const { user } = await login("staff", member.user.email, password);
    assert.equal(user.role, "admin");
  });

  test("the API ignores ADMIN_* settings: no admin is created from the environment", () => {
    const withAdmin = loadConfig({ NODE_ENV: "test", DATABASE_URL: "pg-mem", JWT_SECRET: SECRET, ADMIN_EMAIL: "x@y.test", ADMIN_PASSWORD: "pass-12345" });
    assert.equal("admin" in withAdmin, false);
  });
});

describe("immediate revocation (SEC-02)", () => {
  test("demoting an admin ends their session, so their access token stops working at once", async () => {
    const demoted = await newStaff("admin");
    const admin = await adminAgent();
    assert.equal((await demoted.agent.req("GET", "/api/staff")).status, 200);
    assert.equal((await admin.req("PATCH", `/api/staff/${demoted.id}`, { role: "contributor" })).status, 200);
    assert.equal((await demoted.agent.req("GET", "/api/staff")).status, 401);
  });

  test("deactivating a member blocks their API access immediately", async () => {
    const gone = await newStaff("contributor");
    const admin = await adminAgent();
    assert.equal((await admin.req("PATCH", `/api/staff/${gone.id}`, { isActive: false })).status, 200);
    assert.equal((await gone.agent.req("GET", "/api/clients")).status, 401);
  });

  test("a copied access token dies with logout-all and with logout", async () => {
    const user = await newClientUser("C002");
    const stolen = new Agent();
    stolen.cookies.set("halcyon_at", user.agent.cookies.get("halcyon_at")!);
    assert.equal((await stolen.req("GET", "/api/clients/C002")).status, 200);
    assert.equal((await user.agent.req("POST", "/api/auth/client/logout-all")).status, 204);
    assert.equal((await stolen.req("GET", "/api/clients/C002")).status, 401);

    const other = await newClientUser("C001");
    const copy = new Agent();
    copy.cookies.set("halcyon_at", other.agent.cookies.get("halcyon_at")!);
    assert.equal((await other.agent.req("POST", "/api/auth/client/logout")).status, 204);
    assert.equal((await copy.req("GET", "/api/clients/C001")).status, 401);
  });

  test("an access token keeps working across refresh rotation, and the new one works too", async () => {
    const user = await newClientUser("C001");
    const old = new Agent();
    old.cookies.set("halcyon_at", user.agent.cookies.get("halcyon_at")!);
    assert.equal((await user.agent.req("POST", "/api/auth/client/refresh")).status, 200);
    assert.equal((await user.agent.req("GET", "/api/clients/C001")).status, 200);
    assert.equal((await old.req("GET", "/api/clients/C001")).status, 200);
  });

  test("a password reset by an admin cuts off the member's current session", async () => {
    const member = await newStaff("contributor");
    const admin = await adminAgent();
    assert.equal((await admin.req("PATCH", `/api/staff/${member.id}`, { password: "fresh-pass-123" })).status, 200);
    assert.equal((await member.agent.req("GET", "/api/clients")).status, 401);
  });

  test("a signed access token without a session id is refused", async () => {
    const legacy = await new SignJWT({ typ: "staff", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("00000000-0000-4000-8000-000000000000")
      .setIssuer("halcyon-api")
      .setAudience("halcyon:access")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(SECRET));
    const agent = new Agent();
    agent.cookies.set("halcyon_at", legacy);
    assert.equal((await agent.req("GET", "/api/staff")).status, 401);
  });
});

describe("emailed order requests", () => {
  const email = (messageId: string, from: string, body: string) => ({
    messageId,
    threadId: null,
    mailbox: "orders@halcyon.test",
    from,
    subject: "Order",
    snippet: body.slice(0, 50),
    body,
    dateHeader: null,
    receivedAt: new Date(),
  });
  const ids = async (agent: Agent) =>
    ((await agent.req("GET", "/api/order-requests")).body.emails as { id: string }[]).map((e) => e.id);

  test("a client sees only requests from its own logins, and staff can relink them", async () => {
    const mine = await newClientUser("C001");
    const theirs = await newClientUser("C002");
    const mineEmail = (await mine.agent.req("GET", "/api/auth/client/me")).body.user.email as string;
    await container.repositories.emails.insert(email("m-sender", `Buyer <${mineEmail}>`, "10 bins please"));
    await container.repositories.emails.insert(email("m-body", "someone@gmail.com", `For ${mineEmail}: 3 lamps`));
    await container.repositories.emails.insert(email("m-other", "stranger@gmail.com", "5 trays"));

    assert.deepEqual((await ids(mine.agent)).filter((id) => id.startsWith("m-")).sort(), ["m-body", "m-sender"]);
    assert.deepEqual((await ids(theirs.agent)).filter((id) => id.startsWith("m-")), []);

    const staff = (await newStaff("contributor")).agent;
    assert.equal((await staff.req("PUT", "/api/emails/m-body/request", { edits: { hold: true }, clientId: "C002" })).status, 204);
    assert.equal((await staff.req("PUT", "/api/emails/m-sender/request", { edits: {}, clientId: null })).status, 204);
    assert.deepEqual((await ids(mine.agent)).filter((id) => id.startsWith("m-")), []);
    assert.deepEqual((await ids(theirs.agent)).filter((id) => id.startsWith("m-")), ["m-body"]);

    const saved = (await staff.req("GET", "/api/emails/m-body")).body.email;
    assert.deepEqual(saved.edits, { hold: true, clientId: "C002" });
  });

  test("another client's volume can't push a client's own requests off its list (R-17)", async () => {
    const mine = await newClientUser("C001");
    const mineEmail = (await mine.agent.req("GET", "/api/auth/client/me")).body.user.email as string;
    await container.repositories.emails.insert({ ...email("w-old", `Buyer <${mineEmail}>`, "bins please"), receivedAt: new Date(Date.now() - 86_400_000) });
    // 600 newer requests from someone else: more than the 500 the list returns.
    for (let i = 0; i < 600; i++) await container.repositories.emails.insert(email(`w-flood-${i}`, "flood@other.test", "spam order"));
    assert.ok((await ids(mine.agent)).includes("w-old"));
  });

  test("blank and repeated emails are set aside: staff see why, clients and the carrier plan don't see them", async () => {
    const mine = await newClientUser("C001");
    const mineEmail = (await mine.agent.req("GET", "/api/auth/client/me")).body.user.email as string;
    const at = Date.now();
    await container.repositories.emails.insert({ ...email("i-first", `Buyer <${mineEmail}>`, "10 lamps to Chicago"), receivedAt: new Date(at) });
    await container.repositories.emails.insert({ ...email("i-again", `Buyer <${mineEmail}>`, "10 lamps   to Chicago\n> quoted"), receivedAt: new Date(at + 60_000) });
    await container.repositories.emails.insert({ ...email("i-blank", `Buyer <${mineEmail}>`, "  \n"), receivedAt: new Date(at + 120_000) });

    const staff = (await newStaff("contributor")).agent;
    const view = async (id: string) => (await staff.req("GET", `/api/emails/${id}`)).body.email.ignored;
    assert.equal(await view("i-first"), null);
    assert.deepEqual({ ...(await view("i-again")), at: undefined }, { reason: "duplicate", duplicateOf: "i-first", at: undefined });
    assert.equal((await view("i-blank")).reason, "blank");
    assert.ok((await staff.req("GET", "/api/emails?limit=200")).body.ignored >= 2);

    // Clients only see what's in the queue; the agent and the carrier plan only get queued requests.
    assert.deepEqual((await ids(mine.agent)).filter((id) => id.startsWith("i-")), ["i-first"]);
    const unread = (await container.repositories.emails.listUnreadByAi()).map((r) => r.message_id);
    assert.ok(unread.includes("i-first") && !unread.includes("i-again") && !unread.includes("i-blank"));
    const since = (await container.repositories.emails.listSince(new Date(at - 1000))).map((r) => r.message_id);
    assert.ok(since.includes("i-first") && !since.includes("i-again"));
  });

  test("staff ignore and restore an email; a restored one stays in the queue after the agent reads it", async () => {
    await container.repositories.emails.insert(email("i-promo", "news@vendor.test", "Our autumn catalogue is out!"));
    const staff = (await newStaff("contributor")).agent;
    const view = async (id: string) => (await staff.req("GET", `/api/emails/${id}`)).body.email.ignored;

    // The agent finds no order in it: out of the queue as not_order.
    await container.repositories.emails.markReadByAi("i-promo", { output: { products: [], note: "marketing email" } });
    assert.equal((await view("i-promo")).reason, "not_order");

    assert.equal((await staff.req("PUT", "/api/emails/i-promo/ignored", { ignore: false })).status, 204);
    assert.equal(await view("i-promo"), null);
    assert.equal((await staff.req("PUT", "/api/emails/i-promo/ignored", { ignore: true })).status, 204);
    assert.equal((await view("i-promo")).reason, "staff");
    assert.equal((await staff.req("PUT", "/api/emails/i-nothing/ignored", { ignore: true })).status, 404);
    assert.equal((await staff.req("PUT", "/api/emails/i-promo/ignored", { ignore: "yes" })).status, 400);

    // Restored before the agent reads it: the agent's "no order" doesn't take it out again.
    await container.repositories.emails.insert(email("i-kept", "news@vendor.test", "Can you call me about an order?"));
    assert.equal((await staff.req("PUT", "/api/emails/i-kept/ignored", { ignore: false })).status, 204);
    await container.repositories.emails.markReadByAi("i-kept", { output: { products: [] } });
    assert.equal(await view("i-kept"), null);
  });

  test("a client answers its own request's questions, and only its own", async () => {
    const mine = await newClientUser("C001");
    const theirs = await newClientUser("C002");
    const mineEmail = (await mine.agent.req("GET", "/api/auth/client/me")).body.user.email as string;
    await container.repositories.emails.insert(email("a-own", `Buyer <${mineEmail}>`, "bins please"));
    const staff = (await newStaff("contributor")).agent;
    await staff.req("PUT", "/api/emails/a-own/request", { edits: { ask: { address: true, qty: true }, hold: true } });

    const answer = { address: { street: "200 West Madison Street", city: "Chicago", region: "IL", postal: "60606" }, lines: { "0": { quantity: 300 } }, note: "Dock 4" };
    assert.equal((await theirs.agent.req("POST", "/api/order-requests/a-own/answers", answer)).status, 404);
    assert.equal((await mine.agent.req("POST", "/api/order-requests/a-own/answers", { lines: { "0": { productId: "P9999" } } })).status, 400);
    assert.equal((await mine.agent.req("POST", "/api/order-requests/a-own/answers", answer)).status, 204);

    const edits = (await staff.req("GET", "/api/emails/a-own")).body.email.edits;
    assert.deepEqual(edits.address, answer.address);
    assert.deepEqual(edits.lines, { "0": { quantity: 300 } });
    assert.deepEqual(edits.ask, { address: false, qty: false });
    assert.equal(edits.hold, true);
    assert.equal(edits.answered.note, "Dock 4");
    // Answering doesn't touch the client link: it still comes from the sender.
    assert.equal(edits.clientId, undefined);
  });

  test("a client places an order through the API; staff see it with an expected delivery date and route it", async () => {
    await container.db.query(`INSERT INTO products (product_id, sku, product_name, category, client_id) VALUES
      ('PA01', 'HO-00101', 'Compact lamp', 'Home', 'C001'), ('PB01', 'HO-00201', 'Tray set', 'Home', 'C002')`);
    const mine = await newClientUser("C001");
    const theirs = await newClientUser("C002");
    const address = { street: "200 West Madison Street", city: "Chicago", region: "IL", postal: "60606" };

    // Products from another client's catalogue, or none at all, are refused.
    assert.equal((await mine.agent.req("POST", "/api/order-requests", { lines: [{ productId: "PB01", quantity: 2 }], address })).status, 400);
    assert.equal((await mine.agent.req("POST", "/api/order-requests", { lines: [], address })).status, 400);

    const placed = await mine.agent.req("POST", "/api/order-requests", {
      reference: "PO-7",
      lines: [{ productId: "PA01", quantity: 3 }],
      address,
    });
    assert.equal(placed.status, 201);
    const { id, ref, expectedDelivery } = placed.body;
    assert.match(id, /^api_[0-9a-f]{18}$/);
    assert.equal(ref, `REQ-${id.slice(-6).toUpperCase()}`);
    assert.match(expectedDelivery.date, /^\d{4}-\d{2}-\d{2}$/);

    assert.ok((await ids(mine.agent)).includes(id));
    assert.ok(!(await ids(theirs.agent)).includes(id));

    const staff = (await newStaff("contributor")).agent;
    const order = (await staff.req("GET", `/api/emails/${id}`)).body.email;
    assert.equal(order.channel, "api");
    assert.equal(order.readByAi, true);
    assert.equal(order.matchedClientId, "C001");
    assert.deepEqual(order.aiResult.output.products, [{ sku: "HO-00101", quantity: 3 }]);
    assert.equal(order.aiResult.output.postal_code, "60606");
    assert.equal(order.subject, "API order PO-7");
    assert.ok((await staff.req("GET", "/api/emails?limit=200")).body.emails.some((e: { id: string }) => e.id === id));

    const routed = { routed: { warehouseIds: ["W1"], at: new Date().toISOString() }, clientId: "C001" };
    assert.equal((await staff.req("PUT", `/api/emails/${id}/request`, { edits: routed, clientId: "C001" })).status, 204);
    assert.deepEqual((await staff.req("GET", `/api/emails/${id}`)).body.email.edits.routed.warehouseIds, ["W1"]);
  });

  // Midwest 1 (W1) with 267 of a storage bin and West (W5) with none, as in the dataset; each test starts from this stock.
  const seedWest = async () => {
    await container.db.query(`INSERT INTO warehouses VALUES ('W1', 'Midwest 1', 'Midwest', '08:00', '14:00-18:00'),
      ('W5', 'West', 'West', '08:00', '14:00-18:00') ON CONFLICT DO NOTHING`);
    await container.db.query(`INSERT INTO warehouse_region_distance VALUES ('W1', 150, 700, 800, 1700), ('W5', 1600, 1900, 2400, 160)
      ON CONFLICT DO NOTHING`);
    await container.db.query(`INSERT INTO products (product_id, sku, product_name, category, client_id) VALUES
      ('PW01', 'ME-01074', 'Compact storage bin', 'Home', 'C001') ON CONFLICT DO NOTHING`);
    await container.db.query(`DELETE FROM warehouse_products WHERE product_id = 'PW01'`);
    await container.db.query(`INSERT INTO warehouse_products (warehouse_id, product_id, quantity_on_hand, quantity_reserved, reorder_point)
      VALUES ('W1', 'PW01', 267, 0, 40), ('W5', 'PW01', 0, 0, 20)`);
  };

  test("routing an order past its nearest warehouse, short of stock, logs a stock-out there until it's unrouted", async () => {
    await seedWest();
    const mine = await newClientUser("C001");
    const placed = await mine.agent.req("POST", "/api/order-requests", {
      lines: [{ productId: "PW01", quantity: 2 }],
      address: { street: "1 Market St", city: "San Francisco", region: "CA", postal: "94105" },
    });
    const { id } = placed.body;
    const staff = (await newStaff("contributor")).agent;
    const logged = async () => ((await staff.req("GET", "/api/stockouts")).body.stockouts as { requestId: string }[]).filter((e) => e.requestId === id);

    const at = new Date().toISOString();
    assert.equal((await staff.req("PUT", `/api/emails/${id}/request`, { edits: { routed: { warehouseIds: ["W1"], at } } })).status, 204);
    const [event] = await logged();
    assert.deepEqual(
      { ...event, id: undefined, decidedAt: undefined },
      {
        id: undefined,
        requestId: id,
        orderRef: `REQ-${id.slice(-6).toUpperCase()}`,
        productId: "PW01",
        sku: "ME-01074",
        productName: "Compact storage bin",
        region: "West",
        nearestWarehouseId: "W5",
        quantity: 2,
        availableAtNearest: 0,
        resolution: "rerouted",
        shippedFromId: "W1",
        extraMiles: 1540,
        decidedAt: undefined,
      },
    );
    // Saving something else keeps the event; undoing the route removes it.
    await staff.req("PUT", `/api/emails/${id}/request`, { edits: { routed: { warehouseIds: ["W1"], at }, ask: { qty: false } } });
    assert.equal((await logged()).length, 1);
    await staff.req("PUT", `/api/emails/${id}/request`, { edits: { hold: true } });
    assert.deepEqual(await logged(), []);
  });

  test("applying a rebalance moves the stock Resolve routes on: at once by default, all or nothing, or after the delay", async () => {
    await seedWest();
    const staff = (await newStaff("contributor")).agent;
    const stockOf = async () => {
      const p = ((await staff.req("GET", "/api/products")).body.products as { productId: string; stock: { warehouseId: string; available: number }[] }[])
        .find((x) => x.productId === "PW01")!;
      return Object.fromEntries(p.stock.map((s) => [s.warehouseId, s.available]));
    };
    const move = (quantity: number, origin = "suggested") => ({ productId: "PW01", source: "W1", destination: "W5", quantity, origin });

    assert.equal((await staff.req("POST", "/api/rebalance/apply", { transfers: [{ ...move(5), destination: "W9" }] })).status, 400);
    assert.equal((await staff.req("POST", "/api/rebalance/apply", { transfers: [{ ...move(5), destination: "W1" }] })).status, 400);
    // The second move overdraws W1, so neither is applied.
    const refused = await staff.req("POST", "/api/rebalance/apply", { transfers: [move(10), move(300)] });
    assert.equal(refused.status, 409);
    assert.deepEqual(await stockOf(), { W1: 267, W5: 0 });

    const applied = await staff.req("POST", "/api/rebalance/apply", { transfers: [move(20, "edited")] });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.delayDays, 0);
    assert.deepEqual(
      applied.body.transfers.map((t: { source: string; destination: string; quantity: number; status: string; origin: string }) => [t.source, t.destination, t.quantity, t.status, t.origin]),
      [["W1", "W5", 20, "completed", "edited"]],
    );
    assert.deepEqual(await stockOf(), { W1: 247, W5: 20 });
    const listed = (await staff.req("GET", "/api/rebalance/transfers")).body.transfers as { id: string }[];
    assert.ok(listed.some((t) => t.id === applied.body.transfers[0].id));

    // With STOCK_TRANSFER_DELAY_DAYS=1 the cartons leave W1 now and reach W5 a day later.
    const delayed = new StockTransferService(container.db, container.repositories.stockTransfers, 1);
    const now = new Date();
    const [t] = await delayed.apply([{ productId: "PW01", source: "W1", destination: "W5", quantity: 7, origin: "suggested", reason: null }], "00000000-0000-4000-8000-000000000000", now);
    assert.equal(t.status, "in_transit");
    assert.deepEqual(await stockOf(), { W1: 240, W5: 20 });
    assert.equal(await delayed.completeDue(new Date(now.getTime() + 60 * 60 * 1000)), 0);
    assert.equal(await delayed.completeDue(new Date(now.getTime() + 25 * 60 * 60 * 1000)), 1);
    assert.deepEqual(await stockOf(), { W1: 240, W5: 27 });
    // Landed once only.
    assert.equal(await delayed.completeDue(new Date(now.getTime() + 26 * 60 * 60 * 1000)), 0);
  });

  test("a client sends an order by email: refused until SMTP is set, then mailed to the order inbox", async () => {
    await container.db.query(`INSERT INTO products (product_id, sku, product_name, category, client_id) VALUES
      ('PM01', 'HO-00301', 'Desk fan', 'Home', 'C001'), ('PM02', 'HO-00401', 'Rug', 'Home', 'C002')`);
    const mine = await newClientUser("C001");
    const address = { street: "200 West Madison Street", suite: "Floor 3", city: "Chicago", region: "IL", postal: "60606" };
    const order = { reference: "PO-9", lines: [{ sku: "HO-00301", quantity: 4 }], address, notes: "Dock 2" };

    assert.deepEqual((await mine.agent.req("GET", "/api/order-requests/email")).body, { enabled: false });
    assert.equal((await mine.agent.req("POST", "/api/order-requests/email", order)).status, 503);

    const sent: OutgoingMail[] = [];
    const fake: Mailer = { orderInbox: "orders@halcyon.test", send: async (mail) => (sent.push(mail), { messageId: "<m1@halcyon.test>" }) };
    Object.assign(container.controllers.emails, { mailer: fake });
    try {
      assert.deepEqual((await mine.agent.req("GET", "/api/order-requests/email")).body, { enabled: true, to: "orders@halcyon.test" });
      // Another client's product is refused, and nothing is sent.
      assert.equal((await mine.agent.req("POST", "/api/order-requests/email", { ...order, lines: [{ productId: "PM02", quantity: 1 }] })).status, 400);
      assert.equal(sent.length, 0);

      const res = await mine.agent.req("POST", "/api/order-requests/email", order);
      assert.equal(res.status, 202);
      assert.equal(res.body.to, "orders@halcyon.test");
      assert.equal(sent.length, 1);
      const [mail] = sent;
      assert.equal(mail.to, "orders@halcyon.test");
      assert.equal(mail.subject, "New order PO PO-9 · 4 cartons");
      assert.equal(mail.replyTo, `Client User <${mine.user.email}>`);
      assert.match(mail.text, /- 4 x Desk fan \(SKU HO-00301\)/);
      assert.match(mail.text, /200 West Madison Street, Floor 3\nChicago, IL 60606/);
      assert.match(mail.text, /Notes: Dock 2/);
      // The login in the body is how intake links the emailed order to the client.
      assert.equal(matchClient({ from_address: "orders-bot@halcyon.test", body: mail.text }, await container.repositories.emails.clientLogins()), "C001");
    } finally {
      Object.assign(container.controllers.emails, { mailer: undefined });
    }
  });

  test("an admin sets the same-day cutoff; contributors can't, and dates follow it", async () => {
    const admin = await adminAgent();
    const contributor = (await newStaff("contributor")).agent;
    assert.equal((await contributor.req("PUT", "/api/settings/delivery", { sameDayCutoff: "10:00", timeZone: "UTC" })).status, 403);
    assert.equal((await admin.req("PUT", "/api/settings/delivery", { sameDayCutoff: "25:00", timeZone: "UTC" })).status, 400);
    assert.equal((await admin.req("PUT", "/api/settings/delivery", { sameDayCutoff: "10:00", timeZone: "Mars/Base" })).status, 400);

    await container.repositories.emails.insert({ ...email("cut-early", "x@gmail.com", "1 lamp"), receivedAt: new Date("2026-10-29T09:30:00Z") });
    const early = async () => (await contributor.req("GET", "/api/emails/cut-early")).body.email.expectedDelivery;

    assert.equal((await admin.req("PUT", "/api/settings/delivery", { sameDayCutoff: "10:00", timeZone: "UTC" })).status, 200);
    assert.deepEqual((await contributor.req("GET", "/api/settings")).body.delivery, { sameDayCutoff: "10:00", timeZone: "UTC" });
    assert.equal((await early()).date, "2026-10-29");
    assert.equal((await admin.req("PUT", "/api/settings/delivery", { sameDayCutoff: "08:00", timeZone: "UTC" })).status, 200);
    assert.equal((await early()).date, "2026-10-30");
  });
  test("staff flag a request out of stock with a drafted message; only its client accepts the new date", async () => {
    const mine = await newClientUser("C001");
    const theirs = await newClientUser("C002");
    const mineEmail = (await mine.agent.req("GET", "/api/auth/client/me")).body.user.email as string;
    await container.repositories.emails.insert({ ...email("s-own", `Buyer <${mineEmail}>`, "10 lamps"), receivedAt: new Date("2026-10-29T11:00:00Z") });
    const staff = (await newStaff("contributor")).agent;

    const ask = { customer: "Ana Buyer", ref: "REQ-S-OWN", items: ["Compact lamp ×10"], warehouse: "Midwest 1", originalDate: "2026-10-29", newDate: "2026-11-02" };
    assert.equal((await staff.req("POST", "/api/emails/s-own/stock-flag/draft", { ...ask, newDate: "2026-10-28" })).status, 400);
    // No draft agent in tests, so the template writes it.
    const draft = await staff.req("POST", "/api/emails/s-own/stock-flag/draft", ask);
    assert.equal(draft.status, 200);
    assert.equal(draft.body.source, "template");
    assert.match(draft.body.message, /Compact lamp ×10/);
    assert.match(draft.body.message, /November 2/);

    // Nothing pending yet.
    assert.equal((await mine.agent.req("POST", "/api/order-requests/s-own/stock-flag", { decision: "accept" })).status, 409);
    const stockFlag = { warehouseId: "W1", items: ask.items, originalDate: ask.originalDate, newDate: ask.newDate, message: draft.body.message, source: "template", at: new Date().toISOString(), status: "pending" };
    assert.equal((await staff.req("PUT", "/api/emails/s-own/request", { edits: { stockFlag } })).status, 204);

    assert.equal((await theirs.agent.req("POST", "/api/order-requests/s-own/stock-flag", { decision: "accept" })).status, 404);
    assert.equal((await mine.agent.req("POST", "/api/order-requests/s-own/stock-flag", { decision: "maybe" })).status, 400);
    assert.equal((await mine.agent.req("POST", "/api/order-requests/s-own/stock-flag", { decision: "accept", note: "Fine" })).status, 204);
    assert.equal((await mine.agent.req("POST", "/api/order-requests/s-own/stock-flag", { decision: "decline" })).status, 409);

    const saved = (await staff.req("GET", "/api/emails/s-own")).body.email;
    assert.equal(saved.edits.stockFlag.status, "accepted");
    assert.equal(saved.edits.stockFlag.response, "Fine");
    assert.deepEqual([saved.expectedDelivery.date, saved.expectedDelivery.rescheduled], ["2026-11-02", true]);
  });

  test("the order intake time is kept from the first save that gives one", async () => {
    await container.repositories.emails.insert(email("i-one", "Buyer <buyer@gmail.com>", "bins"));
    const staff = (await newStaff("contributor")).agent;
    const first = "2026-10-29T07:45:00.000Z";
    assert.equal((await staff.req("PUT", "/api/emails/i-one/request", { edits: {} })).status, 204);
    assert.equal((await staff.req("PUT", "/api/emails/i-one/request", { edits: {}, intakeAt: first })).status, 204);
    assert.equal((await staff.req("PUT", "/api/emails/i-one/request", { edits: {}, intakeAt: "2026-10-29T09:00:00.000Z" })).status, 204);
    assert.equal((await staff.req("PUT", "/api/emails/i-one/request", { edits: { intakeAt: "x" }, intakeAt: "not a date" })).status, 400);
    assert.equal((await staff.req("GET", "/api/emails/i-one")).body.email.edits.intakeAt, first);
  });
});
