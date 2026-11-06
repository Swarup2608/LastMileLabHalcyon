// End-to-end auth tests against an in-memory Postgres (pg-mem); never touches DATABASE_URL or .env.
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createContainer } from "../src/container.js";
import { SessionRepository } from "../src/repositories/session.repository.js";
import { seedAdmin } from "../src/services/admin-seed.service.js";

const ORIGIN = "http://localhost:3000";
const ADMIN = { email: "admin@halcyon.test", password: "admin-pass-123", name: "Test Admin" };

// Goes through the real env parser, with an explicit env object instead of process.env.
const CONFIG_ENV = {
  NODE_ENV: "test",
  CORS_ORIGINS: ORIGIN,
  DATABASE_URL: "pg-mem",
  JWT_SECRET: "test-secret-that-is-long-enough-for-hs256-0123456789",
  REFRESH_TOKEN_TTL_SECONDS: "3600",
};
const config = loadConfig(CONFIG_ENV);

let base = "";
let db: Pool;
let close = () => {};

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
    INSERT INTO warehouses VALUES ('W1', 'Midwest 1', 'Midwest', '08:00', '14:00-18:00');
    INSERT INTO warehouses VALUES ('W5', 'West', 'West', '08:00', '14:00-18:00');
    INSERT INTO warehouse_region_distance VALUES ('W1', 150, 700, 800, 1700);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, product_name TEXT NOT NULL,
      category TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients(client_id), unit_price_usd NUMERIC(10, 2) NOT NULL,
      unit_weight_kg NUMERIC(8, 2) NOT NULL);
    INSERT INTO products VALUES ('P0001', 'HA-1037', 'Compact tool kit', 'Hardware', 'C001', 24.50, 1.20);
    INSERT INTO products VALUES ('P0002', 'ME-1074', 'Premium glove box', 'Medical', 'C002', 12.00, 0.40);
    CREATE TABLE warehouse_products (warehouse_id TEXT NOT NULL REFERENCES warehouses(warehouse_id),
      product_id TEXT NOT NULL REFERENCES products(product_id), quantity_on_hand INT NOT NULL,
      quantity_reserved INT NOT NULL, reorder_point INT NOT NULL, bin_location TEXT,
      PRIMARY KEY (warehouse_id, product_id));
    INSERT INTO warehouse_products VALUES ('W1', 'P0001', 120, 20, 40, 'A-01-1');
    INSERT INTO warehouse_products VALUES ('W5', 'P0001', 15, 0, 30, 'B-12-3');`);
  mem.public.none(readFileSync(new URL("../../db/init/02_auth.sql", import.meta.url), "utf8"));
  const { Pool: MemPool } = mem.adapters.createPg();
  db = new MemPool() as Pool;
  const container = createContainer(config, db);
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
  setCookies: string[] = [];

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
    this.setCookies = res.headers.getSetCookie();
    for (const raw of this.setCookies) {
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
  return { agent, res };
};

describe("staff auth", () => {
  test("admin signs in and receives secure httpOnly cookies", async () => {
    const { agent, res } = await login("staff", ADMIN.email, ADMIN.password);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "admin");
    assert.equal(res.body.user.password_hash, undefined);

    const at = agent.setCookies.find((c) => c.startsWith("halcyon_at="))!;
    const rt = agent.setCookies.find((c) => c.startsWith("halcyon_rt="))!;
    for (const c of [at, rt]) {
      assert.match(c, /HttpOnly/);
      assert.match(c, /Secure/);
      assert.match(c, /SameSite=Lax/);
    }
    assert.match(at, /Path=\/;/);
    assert.match(rt, /Path=\/api\/auth/);

    const me = await agent.req("GET", "/api/auth/staff/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, ADMIN.email);
  });

  test("wrong password and unknown email get the same 401", async () => {
    const wrong = await login("staff", ADMIN.email, "not-the-password1");
    const unknown = await login("staff", "nobody@halcyon.test", "whatever-123");
    assert.equal(wrong.res.status, 401);
    assert.deepEqual(wrong.res.body, unknown.res.body);
  });

  test("staff credentials don't work on the client login", async () => {
    const { res } = await login("client", ADMIN.email, ADMIN.password);
    assert.equal(res.status, 401);
  });

  test("admin creates a contributor, who can list clients but not manage staff", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/staff", {
      email: "Contrib@Halcyon.test",
      name: "Casey Contributor",
      role: "contributor",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.staff.email, "contrib@halcyon.test");
    assert.match(created.body.temporaryPassword, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    const dup = await admin.req("POST", "/api/staff", {
      email: "contrib@halcyon.test",
      name: "Again",
      role: "contributor",
    });
    assert.equal(dup.status, 409);

    const { agent: contrib, res } = await login("staff", "contrib@halcyon.test", created.body.temporaryPassword);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "contributor");

    const clients = await contrib.req("GET", "/api/clients?limit=1");
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 2);
    assert.equal(clients.body.clients.length, 1);

    assert.equal((await contrib.req("GET", "/api/staff")).status, 403);
    assert.equal((await contrib.req("POST", "/api/clients/C001/users", {})).status, 403);
  });

  test("weak passwords are rejected, and admins can't choose a new member's password", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const weak = await admin.req("POST", "/api/clients/C001/users", { email: "weak@client001.test", name: "Weak", password: "short" });
    assert.equal(weak.status, 400);
    const chosen = await admin.req("POST", "/api/staff", {
      email: "chosen@halcyon.test",
      name: "Chosen",
      role: "admin",
      password: "admin-chosen-123",
    });
    assert.equal(chosen.status, 400);
  });

  test("an admin can't demote themselves", async () => {
    const { agent: admin, res } = await login("staff", ADMIN.email, ADMIN.password);
    const patch = await admin.req("PATCH", `/api/staff/${res.body.user.id}`, { role: "contributor" });
    assert.equal(patch.status, 400);
  });
});

describe("client auth", () => {
  test("admin creates a client login; the client sees only their own company", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/clients/C001/users", {
      email: "buyer@client001.test",
      name: "Bailey Buyer",
      password: "client-pass-123",
    });
    assert.equal(created.status, 201);
    assert.equal((await admin.req("POST", "/api/clients/C999/users", {
      email: "x@client999.test",
      name: "X",
      password: "client-pass-123",
    })).status, 404);

    const { agent: client, res } = await login("client", "buyer@client001.test", "client-pass-123");
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "client");
    assert.equal(res.body.user.client.clientId, "C001");

    assert.equal((await client.req("GET", "/api/clients/C001")).status, 200);
    assert.equal((await client.req("GET", "/api/clients/C002")).status, 404);
    assert.equal((await client.req("GET", "/api/clients")).status, 403);
    assert.equal((await client.req("GET", "/api/staff")).status, 403);
    assert.equal((await client.req("GET", "/api/auth/staff/me")).status, 403);
    assert.equal((await client.req("GET", "/api/auth/client/me")).status, 200);
  });

  test("deactivating a client user blocks login and refresh", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/clients/C002/users", {
      email: "gone@client002.test",
      name: "Gone",
      password: "client-pass-123",
    });
    const { agent: client } = await login("client", "gone@client002.test", "client-pass-123");

    const patch = await admin.req("PATCH", `/api/clients/C002/users/${created.body.user.id}`, { isActive: false });
    assert.equal(patch.status, 200);
    assert.equal((await client.req("POST", "/api/auth/client/refresh")).status, 401);
    assert.equal((await login("client", "gone@client002.test", "client-pass-123")).res.status, 401);
  });
});

describe("sessions", () => {
  test("refresh rotates the token; replaying the old one right away is refused", async () => {
    const { agent } = await login("staff", ADMIN.email, ADMIN.password);
    const oldRefresh = agent.cookies.get("halcyon_rt")!;

    const refreshed = await agent.req("POST", "/api/auth/staff/refresh");
    assert.equal(refreshed.status, 200);
    const newRefresh = agent.cookies.get("halcyon_rt")!;
    assert.notEqual(newRefresh, oldRefresh);

    // Inside the concurrency grace window a replay is refused without ending the session.
    const attacker = new Agent();
    attacker.cookies.set("halcyon_rt", oldRefresh);
    assert.equal((await attacker.req("POST", "/api/auth/staff/refresh")).status, 401);
    assert.equal((await agent.req("POST", "/api/auth/staff/refresh")).status, 200);
  });

  test("replaying a rotated token after the grace window revokes the whole family", async () => {
    const store = new SessionRepository(db, 3600, 0);
    const owner = "00000000-0000-4000-8000-000000000001";
    const { sessionId: first } = await store.create("staff", owner, {});
    const second = await store.rotate(first, "staff", owner, {});
    assert.equal(second.status, "rotated");

    assert.equal((await store.rotate(first, "staff", owner, {})).status, "reused");
    // The legitimate holder's newer token died with the family.
    assert.equal((await store.rotate((second as { sessionId: string }).sessionId, "staff", owner, {})).status, "reused");
  });

  test("a logged-out refresh token is dead, and replaying it revokes the family", async () => {
    const { agent } = await login("staff", ADMIN.email, ADMIN.password);
    const refresh = agent.cookies.get("halcyon_rt")!;

    const out = await agent.req("POST", "/api/auth/staff/logout");
    assert.equal(out.status, 204);
    assert.ok(agent.setCookies.some((c) => c.startsWith("halcyon_at=;")));
    assert.ok(agent.setCookies.some((c) => c.startsWith("halcyon_rt=;")));
    assert.equal(agent.cookies.size, 0);
    assert.equal((await agent.req("GET", "/api/auth/staff/me")).status, 401);

    const replay = new Agent();
    replay.cookies.set("halcyon_rt", refresh);
    assert.equal((await replay.req("POST", "/api/auth/staff/refresh")).status, 401);
  });

  test("logout-all ends every session for the user", async () => {
    const a = await login("staff", ADMIN.email, ADMIN.password);
    const b = await login("staff", ADMIN.email, ADMIN.password);
    assert.equal((await a.agent.req("POST", "/api/auth/staff/logout-all")).status, 204);
    assert.equal((await b.agent.req("POST", "/api/auth/staff/refresh")).status, 401);
  });

  test("a refresh token is not accepted as an access token", async () => {
    const { agent } = await login("staff", ADMIN.email, ADMIN.password);
    const forged = new Agent();
    forged.cookies.set("halcyon_at", agent.cookies.get("halcyon_rt")!);
    assert.equal((await forged.req("GET", "/api/auth/staff/me")).status, 401);
  });

  test("tampered access tokens are rejected", async () => {
    const { agent } = await login("staff", ADMIN.email, ADMIN.password);
    const [h, p, s] = agent.cookies.get("halcyon_at")!.split(".");
    const forged = new Agent();
    forged.cookies.set("halcyon_at", `${h}.${p}.${s.slice(0, -2)}xx`);
    assert.equal((await forged.req("GET", "/api/auth/staff/me")).status, 401);
  });
});

describe("validation", () => {
  test("invalid bodies return 400 with every zod issue listed", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const res = await admin.req("POST", "/api/clients/C001/users", { email: "nope", name: "", password: "x" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Validation failed");
    const paths = res.body.details.map((d: { path: string }) => d.path).sort();
    // "x" has a letter, so only the length and number rules fail.
    assert.deepEqual(paths, ["email", "name", "password", "password"]);
    const staff = await admin.req("POST", "/api/staff", { email: "nope", name: "", role: "owner" });
    assert.deepEqual(staff.body.details.map((d: { path: string }) => d.path).sort(), ["email", "name", "role"]);
  });

  test("unknown fields on updates are rejected, empty updates too", async () => {
    const { agent: admin, res } = await login("staff", ADMIN.email, ADMIN.password);
    const id = res.body.user.id;
    assert.equal((await admin.req("PATCH", `/api/staff/${id}`, { passwordHash: "x" })).status, 400);
    assert.equal((await admin.req("PATCH", `/api/staff/${id}`, {})).status, 400);
  });

  test("malformed ids are a 400, not a database error", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    assert.equal((await admin.req("GET", "/api/staff/not-a-uuid")).status, 400);
    assert.equal((await admin.req("PATCH", "/api/clients/C001/users/not-a-uuid", { name: "X" })).status, 400);
  });

  test("query params are coerced and bounded", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const ok = await admin.req("GET", "/api/clients?limit=1&offset=1&q=client");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.limit, 1);
    assert.equal(ok.body.clients[0].clientId, "C002");
    assert.equal((await admin.req("GET", "/api/clients?limit=1000")).status, 400);
  });

  test("emails are trimmed and lowercased before they're stored", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/clients/C002/users", {
      email: "  Mixed.Case@Client002.TEST ",
      name: "  Morgan  ",
      password: "client-pass-123",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, "mixed.case@client002.test");
    assert.equal(created.body.user.name, "Morgan");
  });
});

describe("client sign-up", () => {
  const signup = {
    clientName: "Northwind Traders",
    region: "West",
    primaryOrderChannel: "Email",
    accountTier: "Tier 2",
    contact: { name: "Nina North", email: "nina@northwind.test", password: "northwind-123" },
  };

  test("an admin signs up a new client with its first login, under the next client id", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const res = await admin.req("POST", "/api/clients", signup);
    assert.equal(res.status, 201);
    assert.equal(res.body.client.clientId, "C003");
    assert.equal(res.body.client.accountStatus, "active");
    assert.equal(res.body.client.slaPenaltyClause, false);
    assert.equal(res.body.user.clientId, "C003");

    const { res: signedIn } = await login("client", signup.contact.email, signup.contact.password);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.user.client.clientName, "Northwind Traders");

    const listed = await admin.req("GET", "/api/clients?q=northwind");
    assert.equal(listed.body.total, 1);
  });

  test("a taken email is a 409 and leaves no half-created client behind", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const before = (await admin.req("GET", "/api/clients")).body.total;
    const res = await admin.req("POST", "/api/clients", { ...signup, clientName: "Copycat Co" });
    assert.equal(res.status, 409);
    assert.equal((await admin.req("GET", "/api/clients")).body.total, before);
  });

  test("only admins sign up clients, and values outside the dataset's are rejected", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const helper = await admin.req("POST", "/api/staff", { email: "helper@halcyon.test", name: "Helper", role: "contributor" });
    const { agent: contributor } = await login("staff", "helper@halcyon.test", helper.body.temporaryPassword);
    assert.equal((await contributor.req("POST", "/api/clients", signup)).status, 403);

    const bad = await admin.req("POST", "/api/clients", { ...signup, region: "Mars", contact: { ...signup.contact, email: "a@b.test" } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.some((d: { path: string }) => d.path === "region"));
  });
});

describe("own account", () => {
  test("a client changes their email and password; other sessions end, this one carries on", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    await admin.req("POST", "/api/clients/C002/users", {
      email: "first@client002.test",
      name: "First Login",
      password: "temporary-123",
    });
    const { agent: here } = await login("client", "first@client002.test", "temporary-123");
    const { agent: elsewhere } = await login("client", "first@client002.test", "temporary-123");

    const wrong = await here.req("PATCH", "/api/auth/client/me", { currentPassword: "nope-12345", newPassword: "x-new-pass-1" });
    assert.equal(wrong.status, 403);

    const res = await here.req("PATCH", "/api/auth/client/me", {
      currentPassword: "temporary-123",
      email: "Mine@Client002.test",
      newPassword: "my-own-pass-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "mine@client002.test");

    assert.equal((await here.req("GET", "/api/auth/client/me")).status, 200);
    assert.equal((await here.req("POST", "/api/auth/client/refresh")).status, 200);
    assert.equal((await elsewhere.req("POST", "/api/auth/client/refresh")).status, 401);
    assert.equal((await login("client", "first@client002.test", "temporary-123")).res.status, 401);
    assert.equal((await login("client", "mine@client002.test", "my-own-pass-1")).res.status, 200);
  });

  test("an email-only change ends other sessions, this one carries on; a taken email is a 409", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    await admin.req("POST", "/api/clients/C001/users", { email: "two@client001.test", name: "Two", password: "temporary-123" });
    const { agent } = await login("client", "two@client001.test", "temporary-123");
    const { agent: elsewhere } = await login("client", "two@client001.test", "temporary-123");

    const taken = await agent.req("PATCH", "/api/auth/client/me", { currentPassword: "temporary-123", email: "buyer@client001.test" });
    assert.equal(taken.status, 409);
    assert.equal((await elsewhere.req("GET", "/api/auth/client/me")).status, 200);
    const moved = await agent.req("PATCH", "/api/auth/client/me", { currentPassword: "temporary-123", email: "deux@client001.test" });
    assert.equal(moved.status, 200);
    assert.ok(agent.setCookies.length > 0);
    assert.equal((await agent.req("GET", "/api/auth/client/me")).status, 200);
    assert.equal((await agent.req("POST", "/api/auth/client/refresh")).status, 200);
    assert.equal((await elsewhere.req("GET", "/api/auth/client/me")).status, 401);
    assert.equal((await elsewhere.req("POST", "/api/auth/client/refresh")).status, 401);
    assert.equal((await agent.req("PATCH", "/api/auth/client/me", { currentPassword: "temporary-123" })).status, 400);
  });

  test("the name changes without a password; email and password changes need it", async () => {
    const { agent } = await login("client", "deux@client001.test", "temporary-123");

    const renamed = await agent.req("PATCH", "/api/auth/client/me", { name: "  Deux Renamed " });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.name, "Deux Renamed");
    assert.equal(agent.setCookies.length, 0);

    const noPassword = await agent.req("PATCH", "/api/auth/client/me", { email: "trois@client001.test" });
    assert.equal(noPassword.status, 400);
    assert.ok(noPassword.body.details.some((d: { path: string }) => d.path === "currentPassword"));
    assert.equal((await agent.req("PATCH", "/api/auth/client/me", { newPassword: "another-pass-1" })).status, 400);
    assert.equal((await agent.req("PATCH", "/api/auth/client/me", { name: "" })).status, 400);
  });
});

describe("demo accounts", () => {
  test("an admin marks a member as demo; the sign-in page lists it and its password works", async () => {
    const { agent: admin, res: me } = await login("staff", ADMIN.email, ADMIN.password);
    assert.deepEqual((await new Agent().req("GET", "/api/auth/demo-accounts")).body.accounts, []);

    const created = await admin.req("POST", "/api/staff", { email: "demo@halcyon.test", name: "Demo Ops", role: "contributor" });
    const { agent: before } = await login("staff", "demo@halcyon.test", created.body.temporaryPassword);
    const marked = await admin.req("PATCH", `/api/staff/${created.body.staff.id}/demo`, { isDemo: true });
    assert.equal(marked.status, 200);
    assert.equal(marked.body.staff.isDemo, true);
    assert.equal(marked.body.temporaryPassword, undefined);
    assert.equal(marked.body.staff.demo_password, undefined);
    // A fresh password: the one the member had (and their sessions) no longer work.
    assert.equal((await before.req("POST", "/api/auth/staff/refresh")).status, 401);
    assert.equal((await login("staff", "demo@halcyon.test", created.body.temporaryPassword)).res.status, 401);

    const listed = (await new Agent().req("GET", "/api/auth/demo-accounts")).body.accounts;
    assert.equal(listed.length, 1);
    assert.deepEqual(Object.keys(listed[0]).sort(), ["clientName", "email", "name", "password", "realm", "role"]);
    assert.equal(listed[0].realm, "staff");
    const { agent: demo, res } = await login("staff", listed[0].email, listed[0].password);
    assert.equal(res.status, 200);

    // Demo accounts can't change themselves, and admins can't overwrite the listed password.
    assert.equal((await demo.req("PATCH", "/api/auth/staff/me", { name: "Hijacked" })).status, 403);
    assert.equal((await admin.req("PATCH", `/api/staff/${created.body.staff.id}`, { password: "replaced-123" })).status, 400);
    assert.equal((await admin.req("PATCH", `/api/staff/${me.body.user.id}/demo`, { isDemo: true })).status, 400);

    const unmarked = await admin.req("PATCH", `/api/staff/${created.body.staff.id}/demo`, { isDemo: false });
    assert.equal(unmarked.body.staff.isDemo, false);
    assert.match(unmarked.body.temporaryPassword, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    assert.deepEqual((await new Agent().req("GET", "/api/auth/demo-accounts")).body.accounts, []);
    assert.equal((await login("staff", listed[0].email, listed[0].password)).res.status, 401);
    assert.equal((await login("staff", "demo@halcyon.test", unmarked.body.temporaryPassword)).res.status, 200);
  });

  test("client logins can be demo accounts too, and only admins toggle it", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/clients/C002/users", { email: "demo@client002.test", name: "Demo Buyer", password: "client-pass-123" });
    const toggled = await admin.req("PATCH", `/api/clients/C002/users/${created.body.user.id}/demo`, { isDemo: true });
    assert.equal(toggled.status, 200);
    assert.equal((await admin.req("PATCH", `/api/clients/C001/users/${created.body.user.id}/demo`, { isDemo: true })).status, 404);

    const listed = (await new Agent().req("GET", "/api/auth/demo-accounts")).body.accounts;
    const buyer = listed.find((a: { email: string }) => a.email === "demo@client002.test");
    assert.equal(buyer.realm, "client");
    assert.equal(buyer.clientName, "Client 002");
    const { agent: client, res } = await login("client", buyer.email, buyer.password);
    assert.equal(res.status, 200);
    assert.equal((await client.req("PATCH", `/api/clients/C002/users/${created.body.user.id}/demo`, { isDemo: false })).status, 403);

    const contributor = await admin.req("POST", "/api/staff", { email: "toggler@halcyon.test", name: "Toggler", role: "contributor" });
    const { agent: contrib } = await login("staff", "toggler@halcyon.test", contributor.body.temporaryPassword);
    assert.equal((await contrib.req("PATCH", `/api/staff/${contributor.body.staff.id}/demo`, { isDemo: true })).status, 403);
  });
});

describe("warehouses", () => {
  test("any signed-in user lists the warehouses with their region distances", async () => {
    assert.equal((await new Agent().req("GET", "/api/warehouses")).status, 401);
    const { agent } = await login("client", "buyer@client001.test", "client-pass-123");
    const res = await agent.req("GET", "/api/warehouses");
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.warehouses.map((w: { warehouseId: string }) => w.warehouseId),
      ["W1", "W5"],
    );
    assert.equal(res.body.warehouses[0].milesToRegion.West, 1700);
    assert.equal(res.body.warehouses[1].milesToRegion.West, null);
  });
});

describe("products", () => {
  test("staff list every product with its stock; a client user only their own client's", async () => {
    assert.equal((await new Agent().req("GET", "/api/products")).status, 401);

    const { agent: staff } = await login("staff", ADMIN.email, ADMIN.password);
    const all = await staff.req("GET", "/api/products");
    assert.equal(all.status, 200);
    assert.deepEqual(
      all.body.products.map((p: { productId: string }) => p.productId),
      ["P0001", "P0002"],
    );
    // A product no warehouse carries still comes back, with no stock rows.
    assert.deepEqual(all.body.products[1].stock, []);

    const { agent: client } = await login("client", "buyer@client001.test", "client-pass-123");
    const own = await client.req("GET", "/api/products");
    assert.equal(own.status, 200);
    assert.equal(own.body.products.length, 1);
    const [product] = own.body.products;
    assert.equal(product.clientId, "C001");
    assert.equal(product.clientName, "Client 001");
    assert.equal(product.unitPriceUsd, 24.5);
    assert.deepEqual(product.stock, [
      { warehouseId: "W1", onHand: 120, reserved: 20, available: 100, reorderPoint: 40, binLocation: "A-01-1" },
      { warehouseId: "W5", onHand: 15, reserved: 0, available: 15, reorderPoint: 30, binLocation: "B-12-3" },
    ]);
  });
});

describe("DEMO_MODE=false", () => {
  test("hides demo accounts, ends their sign-ins and stops new ones", async () => {
    const { agent: admin } = await login("staff", ADMIN.email, ADMIN.password);
    const created = await admin.req("POST", "/api/staff", { email: "off@halcyon.test", name: "Demo Off", role: "contributor" });
    const other = await admin.req("POST", "/api/staff", { email: "off2@halcyon.test", name: "Not Demo", role: "contributor" });
    await admin.req("PATCH", `/api/staff/${created.body.staff.id}/demo`, { isDemo: true });
    const listed = (await new Agent().req("GET", "/api/auth/demo-accounts")).body.accounts;
    const demo = listed.find((a: { email: string }) => a.email === "off@halcyon.test");
    const { agent: signedIn } = await login("staff", demo.email, demo.password);

    // The same database, with the API restarted on DEMO_MODE=false.
    const off = createApp(createContainer(loadConfig({ ...CONFIG_ENV, DEMO_MODE: "false" }), db)).listen(0);
    await new Promise((resolve) => off.once("listening", resolve));
    const onBase = base;
    base = `http://127.0.0.1:${(off.address() as AddressInfo).port}`;
    try {
      assert.deepEqual((await new Agent().req("GET", "/api/auth/demo-accounts")).body.accounts, []);
      assert.equal((await login("staff", demo.email, demo.password)).res.status, 401);
      assert.equal((await signedIn.req("POST", "/api/auth/staff/refresh")).status, 401);
      assert.equal((await admin.req("PATCH", `/api/staff/${other.body.staff.id}/demo`, { isDemo: true })).status, 409);
      // Taking an account off the list still works, and ordinary sign-in isn't affected.
      assert.equal((await admin.req("PATCH", `/api/staff/${created.body.staff.id}/demo`, { isDemo: false })).status, 200);
      assert.equal((await login("staff", ADMIN.email, ADMIN.password)).res.status, 200);
    } finally {
      base = onBase;
      off.close();
    }
  });
});

describe("csrf and limits", () => {
  test("writes from an unknown origin are refused", async () => {
    const agent = new Agent();
    const res = await agent.req(
      "POST",
      "/api/auth/staff/login",
      { email: ADMIN.email, password: ADMIN.password },
      { origin: "https://evil.example" },
    );
    assert.equal(res.status, 403);
  });

  test("malformed JSON gets a 400, not a 500", async () => {
    const res = await fetch(`${base}/api/auth/staff/login`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });

  test("unauthenticated requests get 401", async () => {
    const agent = new Agent();
    assert.equal((await agent.req("GET", "/api/clients")).status, 401);
    assert.equal((await agent.req("GET", "/api/staff")).status, 401);
  });

  test("repeated failed logins are rate limited", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await login("client", "brute@force.test", `guess-${i}-abcdef`)).res.status;
    assert.equal(last, 429);
  });
});
