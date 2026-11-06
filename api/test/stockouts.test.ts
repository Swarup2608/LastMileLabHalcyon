// Stock-outs at the nearest warehouse: which order lines count, how they're resolved, and how a request's lines are read
// when the web app didn't save them with the decision.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toWarehouseDto } from "../src/repositories/warehouse.repository.js";
import { decisionKey, eventsFor } from "../src/services/stockout.service.js";
import { replyLines } from "../src/utils/reply-lines.js";

const warehouse = (id: string, region: string, west: number | null) =>
  toWarehouseDto({ warehouse_id: id, warehouse_name: id, region, pick_list_cutoff: null, carrier_collection_window: null, midwest: 150, southeast: 700, northeast: 800, west });
// As in the dataset: West (W5) is 160 miles from the West region, Midwest 1 1,700.
const WAREHOUSES = [warehouse("W1", "Midwest", 1700), warehouse("W2", "Midwest", 1500), warehouse("W5", "West", 160)];
const STOCK: Record<string, Record<string, number>> = { P1: { W1: 267, W5: 0 }, P2: { W1: 294, W5: 40 } };
const available = (p: string, w: string) => STOCK[p]?.[w] ?? 0;
const AT = "2026-10-30T15:00:00.000Z";

describe("eventsFor", () => {
  const lines = [{ productId: "P1", quantity: 2 }, { productId: "P2", quantity: 5 }];

  test("an order routed past its nearest warehouse logs each line the nearest was short of, with the extra miles", () => {
    const events = eventsFor({ region: "West", lines, decision: { routed: { warehouseIds: ["W1"], at: AT } }, warehouses: WAREHOUSES, available });
    assert.deepEqual(events, [
      {
        productId: "P1",
        region: "West",
        nearestWarehouseId: "W5",
        quantity: 2,
        availableAtNearest: 0,
        resolution: "rerouted",
        shippedFromId: "W1",
        extraMiles: 1540,
        decidedAt: new Date(AT),
      },
    ]);
  });

  test("a new date offered from the nearest warehouse is delayed; routed there anyway is shipped short", () => {
    const flagged = eventsFor({ region: "West", lines, decision: { stockFlag: { warehouseId: "W5", at: AT } }, warehouses: WAREHOUSES, available });
    assert.deepEqual(flagged.map((e) => [e.productId, e.resolution, e.shippedFromId]), [["P1", "delayed", null]]);
    const short = eventsFor({ region: "West", lines, decision: { routed: { warehouseIds: ["W5"], at: AT } }, warehouses: WAREHOUSES, available });
    assert.deepEqual(short.map((e) => [e.productId, e.resolution, e.extraMiles]), [["P1", "shipped_short", 0]]);
  });

  test("nothing is logged until it's decided, when the region is unknown, or when the nearest has enough", () => {
    assert.deepEqual(eventsFor({ region: "West", lines, decision: {}, warehouses: WAREHOUSES, available }), []);
    assert.deepEqual(eventsFor({ region: null, lines, decision: { routed: { warehouseIds: ["W1"], at: AT } }, warehouses: WAREHOUSES, available }), []);
    assert.deepEqual(eventsFor({ region: "Midwest", lines, decision: { routed: { warehouseIds: ["W2"], at: AT } }, warehouses: WAREHOUSES, available }), []);
  });

  test("the decision key ignores everything but routing and the stock flag", () => {
    assert.equal(decisionKey({ routed: { warehouseIds: ["W1"], at: AT }, ask: { qty: true } }), decisionKey({ routed: { warehouseIds: ["W1"], at: AT } }));
    assert.notEqual(decisionKey({ routed: { warehouseIds: ["W1"], at: AT } }), decisionKey({}));
  });
});

describe("replyLines", () => {
  const catalogue = [
    { productId: "P1", sku: "ME-1074", productName: "Compact storage bin", clientId: "C1", stock: 577 },
    { productId: "P9", sku: "HO-2001", productName: "Compact storage bin", clientId: "C2", stock: 900 },
    { productId: "P2", sku: "AU-1111", productName: "Industrial cover set", clientId: "C1", stock: 294 },
  ];

  test("matches the agent's products like Resolve, the client's own first, with staff's fixes on top", () => {
    const output = { order: { items: [{ name: "Compact storage bin", qty: 2 }, { product: "industrial cover set" }, { name: "Mystery widget", quantity: 3 }] } };
    assert.deepEqual(replyLines(output, undefined, catalogue, "C1"), [
      { productId: "P1", quantity: 2 },
      // No quantity: one, as Resolve assumes.
      { productId: "P2", quantity: 1 },
    ]);
    assert.deepEqual(
      replyLines(output, { "1": { quantity: 5 }, "2": { productId: "P9", quantity: 3 }, "0": { declined: true } }, catalogue, "C1"),
      [{ productId: "P2", quantity: 5 }, { productId: "P9", quantity: 3 }],
    );
  });

  test("reads an API order's payload by SKU", () => {
    assert.deepEqual(replyLines({ products: [{ sku: "ME-1074", quantity: 2 }] }, undefined, catalogue, "C1"), [{ productId: "P1", quantity: 2 }]);
  });
});
