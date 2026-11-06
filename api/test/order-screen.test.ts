// Which incoming orders are set aside: blank emails, repeats, emails with no order, and API orders placed twice.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { apiOrderFingerprint, emailFingerprint, isBlank, noOrderFound, orderText } from "../src/utils/order-screen.js";

describe("blank emails", () => {
  test("no letters or digits in the body is blank, whatever the subject", () => {
    assert.equal(isBlank(""), true);
    assert.equal(isBlank("   \n\t "), true);
    assert.equal(isBlank("-- \nSent from my phone"), true);
    assert.equal(isBlank("> 10 lamps please\n> Chicago"), true);
    assert.equal(isBlank(null, ""), true);
  });

  test("any order text is not blank, in any script; the snippet counts when there's no body", () => {
    assert.equal(isBlank("2"), false);
    assert.equal(isBlank("10 lamps to Chicago"), false);
    assert.equal(isBlank("ランプ 10"), false);
    assert.equal(isBlank(null, "10 bins please"), false);
  });
});

describe("repeated emails", () => {
  const body = "Please send 10 lamps to 200 West Madison Street, Chicago IL 60606.";

  test("the same email again, or re-sent with Re:/Fwd:, spacing or a quoted reply added, is the same order", () => {
    const original = emailFingerprint("Buyer <buyer@acme.test>", "Order", body);
    assert.equal(emailFingerprint("buyer@ACME.test", "Order", body), original);
    assert.equal(emailFingerprint("Buyer <buyer@acme.test>", "Fwd: RE: Order", body), original);
    assert.equal(emailFingerprint("Buyer <buyer@acme.test>", "Order", `  ${body.replace(/ /g, "  ")}\n`), original);
    assert.equal(emailFingerprint("Buyer <buyer@acme.test>", "Order", `${body}\n\nOn Mon, Ops wrote:\n> earlier`), original);
  });

  test("a different sender, subject or order is a different email", () => {
    const original = emailFingerprint("buyer@acme.test", "Order", body);
    assert.notEqual(emailFingerprint("other@acme.test", "Order", body), original);
    assert.notEqual(emailFingerprint("buyer@acme.test", "Order 2", body), original);
    assert.notEqual(emailFingerprint("buyer@acme.test", "Order", body.replace("10", "12")), original);
  });

  test("order text drops quoted replies and signatures", () => {
    assert.equal(orderText("10 lamps\n> old line\n--\nJane"), "10 lamps");
  });
});

describe("emails with no order", () => {
  test("a reply with no products and no address is no order", () => {
    assert.equal(noOrderFound({ products: [], missing: ["products", "address"] }), true);
    assert.equal(noOrderFound('```json\n{"items": [], "note": "newsletter"}\n```'), true);
  });

  test("any product or any part of an address keeps it in the queue", () => {
    assert.equal(noOrderFound({ products: [{ sku: "HA-1037", quantity: 20 }] }), false);
    assert.equal(noOrderFound({ products: [], city: "Chicago" }), false);
    assert.equal(noOrderFound({ order: { lines: [{ name: "lamp" }] } }), false);
  });

  test("a reply that isn't JSON says nothing either way, so staff get it", () => {
    assert.equal(noOrderFound("I couldn't read this email."), false);
    assert.equal(noOrderFound(""), false);
    assert.equal(noOrderFound(null), false);
  });
});

describe("repeated API orders", () => {
  const order = { reference: "PO-1", lines: [{ productId: "P1", quantity: 2 }, { productId: "P2", quantity: 5 }], address: { street: "1 Main St", city: "Chicago" } };

  test("the same client, reference, lines in any order and address are the same order", () => {
    assert.equal(apiOrderFingerprint("C001", { ...order, lines: [...order.lines].reverse(), reference: " po-1 " }), apiOrderFingerprint("C001", order));
  });

  test("another client, reference, quantity or address is a new order", () => {
    const original = apiOrderFingerprint("C001", order);
    assert.notEqual(apiOrderFingerprint("C002", order), original);
    assert.notEqual(apiOrderFingerprint("C001", { ...order, reference: "PO-2" }), original);
    assert.notEqual(apiOrderFingerprint("C001", { ...order, lines: [{ productId: "P1", quantity: 3 }, order.lines[1]] }), original);
    assert.notEqual(apiOrderFingerprint("C001", { ...order, address: { ...order.address, city: "Dallas" } }), original);
  });
});
