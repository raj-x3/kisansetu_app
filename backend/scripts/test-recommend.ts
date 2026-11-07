// Run with: npm run test:recommend
// Checks the best-fit slot recommendation rules. No database needed.

import assert from "node:assert/strict";
import { rankSlots, CapacityInput } from "../src/utils/slotRecommend";

function slot(id: string, start: string, end: string, max: number, booked: number, farmerCapReached = false): CapacityInput {
  return { slotId: id, startTime: start, endTime: end, maxWeightKg: max, bookedWeightKg: booked, confirmedFarmers: 0, farmerCapReached };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// The example from the spec: remaining 500 / 3500 / 2000 / 4000 kg.
const specDay = [
  slot("s1", "09:00", "10:00", 5000, 4500), // 500 left
  slot("s2", "10:00", "11:00", 5000, 1500), // 3500 left
  slot("s3", "11:00", "12:00", 4000, 2000), // 2000 left
  slot("s4", "12:00", "13:00", 4000, 0), //    4000 left
];

test("spec example: 2500 kg -> 10:00 is the best match, 12:00 is an alternative", () => {
  const r = rankSlots(specDay, 2500);
  assert.equal(r[0].slotId, "s2");
  assert.equal(r[0].rank, "RECOMMENDED");
  assert.equal(r[0].reason, "bestFit");
  assert.equal(r[0].afterBookingKg, 1000);
  assert.equal(r[1].slotId, "s4");
  assert.equal(r[1].rank, "ALTERNATIVE");
  assert.equal(r[1].afterBookingKg, 1500);
  const bad = r.filter((x) => x.rank === "NOT_SUITABLE").map((x) => x.slotId).sort();
  assert.deepEqual(bad, ["s1", "s3"]);
  assert.ok(r.filter((x) => x.rank === "NOT_SUITABLE").every((x) => x.reason === "tooSmall" && x.afterBookingKg === null));
});

test("never recommends a slot that cannot hold the whole weight", () => {
  for (const kg of [1, 499, 500, 501, 1999, 2000, 2001, 3500, 3501, 4000, 4001]) {
    for (const s of rankSlots(specDay, kg)) {
      if (s.rank === "RECOMMENDED" || s.rank === "ALTERNATIVE") assert.ok(s.remainingKg >= kg, `${kg} kg in ${s.slotId}`);
    }
  }
});

test("exact fit is allowed (remaining == weight)", () => {
  const r = rankSlots(specDay, 2000);
  assert.equal(r[0].slotId, "s3");
  assert.equal(r[0].afterBookingKg, 0);
});

test("weight larger than every slot -> no recommendation at all", () => {
  const r = rankSlots(specDay, 4001);
  assert.ok(r.every((x) => x.rank === "NOT_SUITABLE"));
});

test("tie on remaining capacity goes to the earlier slot", () => {
  const r = rankSlots([slot("a", "11:00", "12:00", 3000, 0), slot("b", "09:00", "10:00", 3000, 0)], 1000);
  assert.equal(r[0].slotId, "b");
});

test("a full slot is never suitable and says why", () => {
  const r = rankSlots([slot("f", "09:00", "10:00", 3000, 3000), slot("g", "10:00", "11:00", 3000, 0)], 1);
  const full = r.find((x) => x.slotId === "f")!;
  assert.equal(full.status, "FULL");
  assert.equal(full.reason, "full");
  assert.equal(r[0].slotId, "g");
});

test("farmer-count limit makes a slot full even when kilograms are left", () => {
  const r = rankSlots([slot("c", "09:00", "10:00", 5000, 100, true)], 100);
  assert.equal(r[0].status, "FULL");
  assert.equal(r[0].reason, "farmerCap");
  assert.equal(r[0].rank, "NOT_SUITABLE");
});

test("status: Available / Limited / Full", () => {
  const r = rankSlots(
    [slot("a", "09:00", "10:00", 4000, 0), slot("l", "10:00", "11:00", 4000, 3200), slot("f", "11:00", "12:00", 4000, 4000)],
    null
  );
  const by = Object.fromEntries(r.map((x) => [x.slotId, x.status]));
  assert.deepEqual(by, { a: "AVAILABLE", l: "LIMITED", f: "FULL" });
});

test("utilization is a percentage and never above 100", () => {
  const r = rankSlots([slot("a", "09:00", "10:00", 4000, 1000), slot("z", "10:00", "11:00", 0, 0)], null);
  assert.equal(r.find((x) => x.slotId === "a")!.utilizationPct, 25);
  assert.equal(r.find((x) => x.slotId === "z")!.utilizationPct, 100);
  assert.equal(r.find((x) => x.slotId === "z")!.status, "FULL");
});

test("without a weight: slots shown in time order, nothing recommended", () => {
  const r = rankSlots([slot("b", "10:00", "11:00", 100, 0), slot("a", "09:00", "10:00", 100, 0)], null);
  assert.deepEqual(r.map((x) => x.slotId), ["a", "b"]);
  assert.ok(r.every((x) => x.rank === "UNRANKED"));
});

test("two crops in the same slot are ranked from their own numbers only", () => {
  // Wheat is nearly full in the 09:00 slot; paddy in the same slot is empty.
  const wheat = rankSlots([slot("s1", "09:00", "10:00", 5000, 4800)], 1000);
  const paddy = rankSlots([slot("s1", "09:00", "10:00", 3000, 0)], 1000);
  assert.equal(wheat[0].rank, "NOT_SUITABLE");
  assert.equal(paddy[0].rank, "RECOMMENDED");
});

console.log(`\nAll ${passed} checks passed.`);
