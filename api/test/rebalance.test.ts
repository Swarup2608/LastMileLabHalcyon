// Inventory's Rebalance: the demand and input the allocation agent is sent, and how its reply is read and checked.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ProductDto, ProductRepository, ProductStockRow } from "../src/repositories/product.repository.js";
import { toWarehouseDto, type WarehouseRepository } from "../src/repositories/warehouse.repository.js";
import { productInput, RebalanceService } from "../src/services/rebalance.service.js";
import type { WarehouseDemand } from "../src/services/stockout.service.js";
import { readPlan, type RebalanceInput } from "../src/utils/rebalance-validate.js";

const warehouse = (id: string, region: string, miles: [number, number, number, number]) =>
  toWarehouseDto({
    warehouse_id: id,
    warehouse_name: id,
    region,
    pick_list_cutoff: null,
    carrier_collection_window: null,
    midwest: miles[0],
    southeast: miles[1],
    northeast: miles[2],
    west: miles[3],
  });
const WAREHOUSES = [
  warehouse("W1", "Midwest", [150, 700, 800, 1700]),
  warehouse("W2", "Midwest", [200, 600, 600, 1500]),
  warehouse("W3", "Southeast", [650, 140, 850, 1900]),
];

const stock = (warehouseId: string, available: number, reorderPoint: number) => ({
  warehouseId,
  onHand: available + 5,
  reserved: 5,
  available,
  reorderPoint,
  binLocation: null,
});
const demand = (entries: [string, Partial<WarehouseDemand>][]) =>
  new Map(entries.map(([id, d]) => [id, { routed: 0, missed: 0, sentForOthers: 0, ...d }]));

const PRODUCT: ProductDto = {
  productId: "P0001",
  sku: "OF-1037",
  productName: "Compact lamp",
  category: "Office",
  clientId: "C001",
  clientName: "Acme",
  clientRegion: "Midwest",
  primaryOrderChannel: null,
  unitPriceUsd: 50,
  unitWeightKg: 1,
  stock: [stock("W1", 35, 40), stock("W2", 150, 30)],
};

describe("productInput", () => {
  test("sends each warehouse's figures and routes from spare stock to short warehouses", () => {
    // W3 was the nearest for 10 cartons it doesn't stock; W2 shipped them instead.
    const input = productInput(PRODUCT, WAREHOUSES, demand([["W1", { routed: 50, missed: 15 }], ["W2", { routed: 10, sentForOthers: 10 }], ["W3", { missed: 10 }]]));
    assert.equal(input.product, "OF-1037");
    assert.equal(input.totalAvailability, 185);
    assert.deepEqual(input.warehouses.map((w) => w.id), ["W1", "W2", "W3"]);
    const [w1, w2, w3] = input.warehouses;
    // 50 routed + 15 missed; 15 of those 65 missed.
    assert.deepEqual([w1.orders, w1.outOfStockPercentage, w1.stockoutsAtNearest], [65, 23.1, 15]);
    // Its 10 were for W3, so they count there, not here.
    assert.deepEqual([w2.orders, w2.outOfStockPercentage], [0, 0]);
    assert.deepEqual([w3.orders, w3.outOfStockPercentage], [10, 100]);
    assert.equal(w1.presentValue, 1750);
    assert.equal(w1.safetyBuffer, 40);
    assert.equal(w1.distanceToCustomer, 150);
    // W3 doesn't stock it but had orders: no stock, no reorder point.
    assert.deepEqual([input.warehouses[2].availableStock, input.warehouses[2].safetyBuffer], [0, null]);
    assert.deepEqual(
      input.routes.map((r) => [r.from, r.to, r.distance]),
      [["W2", "W1", 200], ["W2", "W3", 600]],
    );
  });
});

describe("readPlan", () => {
  const input: RebalanceInput = {
    settings: { orderUnit: "cartons", oosBasis: null, presentValueDefinition: "" },
    products: [productInput(PRODUCT, WAREHOUSES, demand([["W1", { routed: 50 }]])), { ...productInput(PRODUCT, WAREHOUSES, undefined), product: "OF-2000" }],
  };

  test("keeps usable transfers, drops impossible ones, and recounts the summary", () => {
    const reply = "```json\n" + JSON.stringify({
      products: [
        {
          product: "OF-1037",
          decision: "yes",
          nearestWarehouse: "W1",
          stockoutRisk: "HIGH",
          affectedWarehouses: ["W1", "W9"],
          reallocationReason: "W1 is short",
          recommendedTransfers: [
            { source: "W2", destination: "W1", quantity: 15, distance: null, reason: "cover W1" },
            { source: "W2", destination: "W2", quantity: 5, distance: 0, reason: "" },
            { source: "W5", destination: "W1", quantity: 5, distance: 0, reason: "" },
          ],
          expectedImpact: "W1 covered",
          remainingShortage: 0,
          notes: [],
        },
      ],
      summary: { reallocationRequired: 1, totalTransferUnits: 25, overallOutOfStockPercentage: 30 },
      contributorNotes: ["No transfer costs in the data."],
    }) + "\n```";
    const { plan, warnings } = readPlan(reply, input);
    const [lamp, other] = plan.products;
    assert.equal(lamp.decision, "YES");
    assert.deepEqual(lamp.affectedWarehouses, ["W1"]);
    // The route's distance fills in the one the agent left null.
    assert.deepEqual(lamp.recommendedTransfers, [{ source: "W2", destination: "W1", quantity: 15, distance: 200, reason: "cover W1" }]);
    assert.equal(other.decision, "REVIEW");
    assert.deepEqual(plan.summary, {
      totalProducts: 2,
      reallocationRequired: 1,
      noReallocationRequired: 0,
      reviewRequired: 1,
      totalTransferUnits: 15,
      estimatedOrdersAffected: null,
      overallOutOfStockPercentage: 30,
      unresolvedProducts: ["OF-2000"],
    });
    assert.deepEqual(plan.contributorNotes, ["No transfer costs in the data."]);
    assert.ok(warnings.some((w) => w.includes("to itself")));
    assert.ok(warnings.some((w) => w.includes("W5")));
    assert.ok(warnings.some((w) => w.includes("OF-2000") && w.includes("didn't answer")));
    assert.ok(warnings.some((w) => w.includes("totalTransferUnits was 25")));
  });

  test("warns when a source would send more than it has, and turns YES without transfers into REVIEW", () => {
    const reply = JSON.stringify({
      products: [
        { product: "OF-1037", decision: "YES", recommendedTransfers: [{ source: "W2", destination: "W1", quantity: 400 }] },
        { product: "OF-2000", decision: "YES", recommendedTransfers: [] },
      ],
    });
    const { plan, warnings } = readPlan(reply, input);
    assert.equal(plan.products[0].recommendedTransfers[0].quantity, 400);
    assert.ok(warnings.some((w) => w.includes("400 out of W2, which has 150")));
    assert.equal(plan.products[1].decision, "REVIEW");
  });

  test("a reply that isn't JSON leaves every product for review", () => {
    const { plan, warnings } = readPlan("Sorry, I can't help with that.", input);
    assert.deepEqual(plan.products.map((p) => p.decision), ["REVIEW", "REVIEW"]);
    assert.equal(warnings.length, 1);
  });
});

describe("simulatedInput", () => {
  // The catalogue as the database has it: 35 and 150 cartons in W1 and W2, with real demand the simulation mustn't use.
  const row = (warehouse: string, onHand: number, reserved: number, reorder: number): ProductStockRow =>
    ({
      product_id: "P0001", sku: "OF-1037", product_name: "Compact lamp", category: "Office", client_id: "C001", client_name: "Acme",
      client_region: "Midwest", primary_order_channel: null, unit_price_usd: "50", unit_weight_kg: "1",
      warehouse_id: warehouse, quantity_on_hand: onHand, quantity_reserved: reserved, reorder_point: reorder, bin_location: null,
    }) as ProductStockRow;
  const products = { listWithStock: async () => [row("W1", 40, 5, 40), row("W2", 155, 5, 30)] } as unknown as ProductRepository;
  const warehouses = {
    list: async () => [
      { warehouse_id: "W1", warehouse_name: "W1", region: "Midwest", pick_list_cutoff: null, carrier_collection_window: null, midwest: 150, southeast: 700, northeast: 800, west: 1700 },
      { warehouse_id: "W2", warehouse_name: "W2", region: "Midwest", pick_list_cutoff: null, carrier_collection_window: null, midwest: 200, southeast: 600, northeast: 600, west: 1500 },
    ],
  } as unknown as WarehouseRepository;
  const untouched = new Proxy({}, { get: () => () => assert.fail("the database's orders, stock-outs and transfers must not be read") });
  const service = new RebalanceService(products, warehouses, untouched as never, untouched as never);

  test("uses the simulation's stock and demand with the real catalogue and warehouses", async () => {
    const input = await service.simulatedInput([
      { productId: "P0001", stock: { W1: 4, W2: 90 }, demand: { W1: { routed: 10, missed: 12, sentForOthers: 0 } } },
      { productId: "P9999", stock: {}, demand: {} },
    ]);
    assert.equal(input.products.length, 1);
    const [p] = input.products;
    assert.equal(p.productName, "Compact lamp");
    const w = (id: string) => p.warehouses.find((x) => x.id === id)!;
    assert.equal(w("W1").availableStock, 4);
    assert.equal(w("W1").reservedStock, 0);
    assert.equal(w("W1").safetyBuffer, 40);
    assert.equal(w("W1").stockoutsAtNearest, 12);
    assert.equal(w("W1").orders, 22);
    assert.equal(w("W2").availableStock, 90);
    assert.deepEqual(p.routes.map((r) => [r.from, r.to]), [["W2", "W1"]]);
  });
});
