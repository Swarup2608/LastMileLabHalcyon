import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectedDelivery } from "../src/utils/delivery.js";

const rule = { sameDayCutoff: "08:00", timeZone: "America/New_York" };

describe("expected delivery", () => {
  test("before the cutoff delivers the same day, from the cutoff on the next day", () => {
    // 07:59 and 08:00 in New York (UTC-4 in October).
    assert.deepEqual(expectedDelivery(new Date("2026-10-29T11:59:00Z"), rule), {
      date: "2026-10-29", sameDay: true, cutoff: "08:00", timeZone: "America/New_York", rescheduled: false,
    });
    const late = expectedDelivery(new Date("2026-10-29T12:00:00Z"), rule);
    assert.equal(late.date, "2026-10-30");
    assert.equal(late.sameDay, false);
  });

  test("the day is read in the cutoff's time zone, across month ends", () => {
    // 01:00 UTC on Nov 1 is still Oct 31 in New York, at 21:00: after the cutoff, so Nov 1.
    assert.equal(expectedDelivery(new Date("2026-11-01T01:00:00Z"), rule).date, "2026-11-01");
    assert.equal(expectedDelivery(new Date("2026-12-31T20:00:00Z"), rule).date, "2027-01-01");
  });

  test("a later cutoff and an accepted new date", () => {
    assert.equal(expectedDelivery(new Date("2026-10-29T15:00:00Z"), { ...rule, sameDayCutoff: "13:00" }).sameDay, true);
    const moved = expectedDelivery(new Date("2026-10-29T11:00:00Z"), rule, "2026-11-03");
    assert.equal(moved.date, "2026-11-03");
    assert.equal(moved.rescheduled, true);
  });
});
