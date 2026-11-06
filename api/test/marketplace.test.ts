// The public marketplace against an in-memory Postgres (pg-mem); never touches DATABASE_URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createContainer } from "../src/container.js";
import { seedAdmin } from "../src/services/admin-seed.service.js";

const ORIGIN = "http://localhost:3000";
const ADMIN = { email: "admin@halcyon.test", password: "admin-pass-123", name: "Test Admin" };
const config = loadConfig({
  NODE_ENV: "test",
  CORS_ORIGINS: ORIGIN,
  DATABASE_URL: "pg-mem",
  JWT_SECRET: "test-secret-that-is-long-enough-for-hs256-0123456789",
});

let base = "";
let close = () => {};
let container: ReturnType<typeof createContainer>;

class Agent {
  cookies = new Map<string, string>();

  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        origin: ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of res.headers.getSetCookie()) {
      const [name, value] = header.split(";")[0].split("=");
      if (value) this.cookies.set(name, value);
    }
    const out = await res.text();
    return { status: res.status, body: out ? JSON.parse(out) : null };
  }
}

const rows = async (sql: string) => (await container.db.query(sql)).rows;
const total = async (table: string) => Number((await rows(`SELECT count(*) AS n FROM ${table}`))[0].n);

let n = 0;
// A distinct buyer each time, so tests don't collide on the email.
const purchase = (over: Record<string, unknown> = {}) => ({
  companyName: "Open Door Supply",
  contact: { name: "Ria Sen", email: `ria${++n}@opendoor.test`, password: "open-door-2026" },
  order: { lines: [{ productId: "P0001", quantity: 3 }], address: { street: "200 W Madison St", city: "Chicago", region: "IL", postal: "60606" } },
  ...over,
});

before(async () => {
  const mem = newDb();
  mem.public.none(`
    CREATE TABLE clients (client_id TEXT PRIMARY KEY, client_name TEXT, region TEXT, primary_order_channel TEXT,
      account_tier TEXT, sla_penalty_clause CHAR(1), annual_revenue_usd NUMERIC, account_status TEXT);
    INSERT INTO clients VALUES ('C001', 'Client 001', 'Northeast', 'Email', 'Tier 2', 'N', 446000, 'active');
    CREATE TABLE warehouses (warehouse_id TEXT PRIMARY KEY, warehouse_name TEXT, region TEXT);
    INSERT INTO warehouses VALUES ('W1', 'Midwest 1', 'Midwest'), ('W2', 'Midwest 2', 'Midwest'), ('W3', 'Southeast', 'Southeast');
    CREATE TABLE products (product_id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, product_name TEXT, category TEXT, client_id TEXT,
      unit_price_usd NUMERIC, unit_weight_kg NUMERIC);
    INSERT INTO products VALUES ('P0001', 'HA-1037', 'Compact storage bin', 'Hardware', 'C001', 42.5, 3.2),
      ('P0002', 'ME-1074', 'Premium glove box', 'Medical', 'C001', 18, 1.1);
    CREATE TABLE warehouse_products (warehouse_id TEXT, product_id TEXT, quantity_on_hand INT, quantity_reserved INT,
      reorder_point INT, bin_location TEXT, updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (warehouse_id, product_id));
    INSERT INTO warehouse_products (warehouse_id, product_id, quantity_on_hand, quantity_reserved, reorder_point) VALUES
      ('W1', 'P0001', 267, 7, 40), ('W1', 'P0002', 0, 0, 20);`);
  for (const f of ["02_auth", "05_inbound_emails", "06_order_requests", "13_ignored_orders", "08_settings"])
    mem.public.none(readFileSync(new URL(`../../db/init/${f}.sql`, import.meta.url), "utf8"));
  const { Pool: MemPool } = mem.adapters.createPg();
  container = createContainer(config, new MemPool() as Pool);
  await seedAdmin(container.repositories.staff, ADMIN);
  const server = createApp(container).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => close());

describe("marketplace catalogue (GET /api/marketplace/products)", () => {
  test("anyone can read it, with no owner, warehouse or stock figure in the answer", async () => {
    const res = await new Agent().req("GET", "/api/marketplace/products");
    assert.equal(res.status, 200);
    const bin = res.body.products.find((p: { sku: string }) => p.sku === "HA-1037");
    assert.deepEqual(Object.keys(bin).sort(), ["category", "inStock", "productId", "productName", "sku", "unitPriceUsd"]);
    assert.equal(bin.inStock, true);
    assert.equal(res.body.products.find((p: { sku: string }) => p.sku === "ME-1074").inStock, false);
  });

  test("search and category filter, and the page size is capped", async () => {
    const agent = new Agent();
    assert.deepEqual((await agent.req("GET", "/api/marketplace/products?q=GLOVE")).body.products.map((p: { sku: string }) => p.sku), ["ME-1074"]);
    assert.equal((await agent.req("GET", "/api/marketplace/products?category=Hardware")).body.products[0].sku, "HA-1037");
    assert.equal((await agent.req("GET", "/api/marketplace/products?limit=1000")).status, 400);
  });
});

describe("marketplace order (POST /api/marketplace/orders)", () => {
  test("a visitor's order creates the client, its login and the order, and signs them in", async () => {
    const agent = new Agent();
    const body = purchase();
    const res = await agent.req("POST", "/api/marketplace/orders", body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.ref, /^REQ-[0-9A-F]{6}$/);
    assert.equal(res.body.client.region, "Midwest");
    assert.equal(res.body.client.accountTier, "Tier 3");
    const mine = await agent.req("GET", "/api/order-requests");
    assert.equal(mine.status, 200);
    const orders = mine.body.emails ?? mine.body.requests ?? mine.body;
    assert.equal(JSON.stringify(orders).includes(res.body.id), true);
    assert.equal(JSON.stringify(res.body).includes(body.contact.password), false);
  });

  test("the new client has a full, stocked catalogue of its own", async () => {
    const agent = new Agent();
    await agent.req("POST", "/api/marketplace/orders", purchase());
    const { products } = (await agent.req("GET", "/api/products")).body;
    assert.equal(products.length, 6);
    assert.equal(products.every((p: { stock: { available: number }[] }) => p.stock.length > 0 && p.stock.every((s) => s.available > 0)), true);
  });

  test("a client an admin signs up gets a full catalogue too", async () => {
    const admin = new Agent();
    await admin.req("POST", "/api/auth/staff/login", { email: ADMIN.email, password: ADMIN.password });
    const res = await admin.req("POST", "/api/clients", {
      clientName: "Admin Added Co", region: "West", primaryOrderChannel: "EDI", accountTier: "Tier 1",
      contact: { name: "Lee Park", email: "lee@adminadded.test", password: "admin-added-2026" },
    });
    assert.equal(res.status, 201);
    const held = await rows(`SELECT product_id FROM products WHERE client_id = '${res.body.client.clientId}'`);
    assert.equal(held.length, 6);
  });

  test("a buyer can't set their own tier, terms or client", async () => {
    for (const extra of [{ accountTier: "Tier 1" }, { slaPenaltyClause: true }, { clientId: "C001" }]) {
      assert.equal((await new Agent().req("POST", "/api/marketplace/orders", purchase(extra))).status, 400);
    }
  });

  test("a refused order leaves nothing behind", async () => {
    const before = [await total("clients"), await total("client_users"), await total("order_requests"), await total("products")];
    const unknown = purchase({ order: { ...purchase().order, lines: [{ productId: "P9999", quantity: 1 }] } });
    const res = await new Agent().req("POST", "/api/marketplace/orders", unknown);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Not in the marketplace: P9999");
    const bad = purchase({ order: { ...purchase().order, address: { street: "1 Road", city: "X", region: "Narnia", postal: "ABCDE" } } });
    assert.equal((await new Agent().req("POST", "/api/marketplace/orders", bad)).status, 400);
    assert.deepEqual([await total("clients"), await total("client_users"), await total("order_requests"), await total("products")], before);
  });

  test("an email that already has a login is refused, and nothing is created", async () => {
    const first = purchase();
    assert.equal((await new Agent().req("POST", "/api/marketplace/orders", first)).status, 201);
    const clients = await total("clients");
    const again = await new Agent().req("POST", "/api/marketplace/orders", { ...first, companyName: "Copycat" });
    assert.equal(again.status, 409);
    assert.equal(await total("clients"), clients);
  });

  test("the buyer gets client access, not staff access", async () => {
    const agent = new Agent();
    await agent.req("POST", "/api/marketplace/orders", purchase());
    assert.equal((await agent.req("GET", "/api/clients")).status, 403);
    assert.equal((await agent.req("GET", "/api/emails")).status, 403);
  });

  test("the audit log records the order and never the password", async () => {
    const body = purchase();
    await new Agent().req("POST", "/api/marketplace/orders", body);
    const log = await rows(`SELECT details FROM audit_log WHERE action = 'marketplace.order'`);
    assert.ok(log.length > 0);
    assert.equal(JSON.stringify(log).includes(body.contact.password), false);
  });

  test("too many sign-ups from one address are refused", async () => {
    let last = 0;
    for (let i = 0; i < 12 && last !== 429; i++) last = (await new Agent().req("POST", "/api/marketplace/orders", purchase())).status;
    assert.equal(last, 429);
  });
});
