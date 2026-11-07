// Run with: npm run test:waitlist
// Checks who gets released room and why. No database needed.

import assert from "node:assert/strict";
import { planOffers, evaluateEntry, MatchEntry, MatchSlot, MatchContext } from "../src/utils/waitlistMatch";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const NOW = Date.UTC(2026, 10, 6, 4, 0);
const DAY = "2026-11-07";

function entry(id: string, kg: number, minutesAgo: number, extra: Partial<MatchEntry> = {}): MatchEntry {
  return {
    id, farmerId: `f-${id}`, centreId: "c1", cropId: "wheat", quantityKg: kg, preferredDate: DAY,
    windowStart: null, windowEnd: null, createdAtMs: NOW - minutesAgo * 60_000, status: "ACTIVE", ...extra,
  };
}
function slot(remainingKg: number, extra: Partial<MatchSlot> = {}): MatchSlot {
  return {
    slotId: "s1", centreId: "c1", cropId: "wheat", date: DAY, startTime: "10:00", endTime: "11:00",
    remainingKg, placesLeft: 50, endMs: NOW + 30 * 3600_000, ...extra,
  };
}
const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  nowMs: NOW, bookedDates: new Map(), pendingOfferDates: new Map(), offeredBefore: new Set(), ...over,
});

test("spec example: 4000 kg released; A(5000) skipped, B(2500) offered, C(3500) no longer fits, D(1500) offered", () => {
  const entries = [entry("A", 5000, 40), entry("B", 2500, 30), entry("C", 3500, 20), entry("D", 1500, 10)];
  const p = planOffers(slot(4000), entries, ctx());
  assert.deepEqual(p.offers.map((o) => o.entryId), ["B", "D"]);
  assert.equal(p.remainingAfterKg, 0);
  const by = Object.fromEntries(p.decisions.map((d) => [d.entryId, d]));
  assert.equal(by.A.reason, "notFullFit");
  assert.equal(by.A.shortfallKg, 1000);
  assert.equal(by.C.reason, "notFullFit"); // fit alone, but B already holds the room
  assert.equal(by.B.eligible, true);
});

test("a farmer is never offered more than the room left (never goes negative)", () => {
  const entries = [entry("A", 3000, 5), entry("B", 3000, 4), entry("C", 3000, 3)];
  const p = planOffers(slot(7000), entries, ctx());
  assert.equal(p.offers.length, 2);
  assert.ok(p.remainingAfterKg >= 0);
  assert.equal(p.remainingAfterKg, 1000);
});

test("first come, first served among farmers who fit", () => {
  const entries = [entry("late", 1000, 1), entry("early", 1000, 60), entry("mid", 1000, 30)];
  const p = planOffers(slot(1000), entries, ctx());
  assert.deepEqual(p.offers.map((o) => o.entryId), ["early"]);
});

test("same registration time -> stable order by id", () => {
  const a = entry("b", 500, 10);
  const b = entry("a", 500, 10);
  const p = planOffers(slot(500), [a, b], ctx());
  assert.deepEqual(p.offers.map((o) => o.entryId), ["a"]);
});

test("a farmer who does not fit is skipped, a smaller one behind them gets it", () => {
  const p = planOffers(slot(2000), [entry("big", 3000, 20), entry("small", 1500, 10)], ctx());
  assert.deepEqual(p.offers.map((o) => o.entryId), ["small"]);
});

test("crop isolation: a wheat farmer is never offered paddy room", () => {
  const p = planOffers(slot(9000, { cropId: "paddy" }), [entry("W", 1000, 10)], ctx());
  assert.equal(p.offers.length, 0);
  assert.equal(p.decisions[0].reason, "wrongCrop");
});

test("centre isolation", () => {
  const p = planOffers(slot(9000, { centreId: "c2" }), [entry("A", 1000, 10)], ctx());
  assert.equal(p.decisions[0].reason, "wrongCentre");
});

test("preferred date must match", () => {
  const p = planOffers(slot(9000, { date: "2026-11-08" }), [entry("A", 1000, 10)], ctx());
  assert.equal(p.decisions[0].reason, "wrongDate");
});

test("preferred time range: slot must lie inside it", () => {
  const e = entry("A", 1000, 10, { windowStart: "11:00", windowEnd: "14:00" });
  assert.equal(planOffers(slot(5000), [e], ctx()).decisions[0].reason, "outsideTimeRange"); // 10-11 is before 11:00
  assert.equal(planOffers(slot(5000, { startTime: "11:00", endTime: "12:00" }), [e], ctx()).offers.length, 1);
  assert.equal(planOffers(slot(5000, { startTime: "13:30", endTime: "14:30" }), [e], ctx()).decisions[0].reason, "outsideTimeRange");
});

test("a slot that has already ended is never offered", () => {
  const p = planOffers(slot(5000, { endMs: NOW - 1 }), [entry("A", 1000, 10)], ctx());
  assert.equal(p.decisions[0].reason, "slotPast");
});

test("no farmer place left in the slot -> no offer, even if the weight fits", () => {
  const p = planOffers(slot(5000, { placesLeft: 0 }), [entry("A", 1000, 10)], ctx());
  assert.equal(p.decisions[0].reason, "noFarmerPlace");
});

test("farmer places run out part-way: only as many offers as places", () => {
  const p = planOffers(slot(9000, { placesLeft: 1 }), [entry("A", 1000, 20), entry("B", 1000, 10)], ctx());
  assert.deepEqual(p.offers.map((o) => o.entryId), ["A"]);
});

test("farmer already booked that day is skipped", () => {
  const p = planOffers(slot(5000), [entry("A", 1000, 10)], ctx({ bookedDates: new Map([["f-A", new Set([DAY])]]) }));
  assert.equal(p.decisions[0].reason, "alreadyBooked");
});

test("farmer with a pending offer that day is skipped", () => {
  const p = planOffers(slot(5000), [entry("A", 1000, 10)], ctx({ pendingOfferDates: new Map([["f-A", new Set([DAY])]]) }));
  assert.equal(p.decisions[0].reason, "hasPendingOffer");
});

test("the same farmer is not offered twice for one date in one pass", () => {
  const a = entry("A1", 1000, 20, { farmerId: "same" });
  const b = entry("A2", 1000, 10, { farmerId: "same" });
  const p = planOffers(slot(9000), [a, b], ctx());
  assert.equal(p.offers.length, 1);
  assert.equal(p.decisions[1].reason, "hasPendingOffer");
});

test("a farmer who declined or missed this slot is not offered it again", () => {
  const p = planOffers(slot(5000), [entry("A", 1000, 10)], ctx({ offeredBefore: new Set(["A|s1"]) }));
  assert.equal(p.decisions[0].reason, "previouslyOffered");
});

test("entries that are not ACTIVE are ignored", () => {
  for (const status of ["OFFERED", "FULFILLED", "WITHDRAWN", "EXPIRED"] as const) {
    assert.equal(evaluateEntry(entry("A", 1000, 10, { status }), slot(5000), 5000, 5, ctx()).reason, "notActive");
  }
});

test("exact fit is allowed", () => {
  assert.equal(planOffers(slot(2500), [entry("A", 2500, 10)], ctx()).offers.length, 1);
});

test("nobody waiting -> nothing offered, all room stays public", () => {
  const p = planOffers(slot(4000), [], ctx());
  assert.equal(p.offers.length, 0);
  assert.equal(p.remainingAfterKg, 4000);
});

console.log(`\n${passed} tests passed.`);
