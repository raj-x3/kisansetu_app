// Run with: npm run test:queue
// Checks the waiting-time maths, congestion classification and look-ahead.
// No database needed.

import assert from "node:assert/strict";
import {
  rollingServiceTime,
  effectiveCounters,
  estimateWait,
  classifyCentre,
  predictCongestion,
  STAGE_REMAINING,
} from "../src/utils/queueEstimate";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const cfg = { minSamples: 3, sampleMinMinutes: 1, sampleMaxMinutes: 240 };
const est = (workloadMin: number, counters: number, extra: Partial<Parameters<typeof estimateWait>[0]> = {}) =>
  estimateWait({ workloadMin, counters, ownServiceMin: 10, delayMin: 0, basis: "MEASURED", spreadMeasured: 0.2, spreadBaseline: 0.35, ...extra });

test("not enough real samples -> baseline, labelled as baseline", () => {
  const s = rollingServiceTime([12, 14], 10, cfg);
  assert.equal(s.basis, "BASELINE");
  assert.equal(s.minutes, 10);
  assert.equal(s.samples, 2);
});

test("enough samples -> rolling average, labelled as measured", () => {
  const s = rollingServiceTime([10, 12, 14, 16], 10, cfg);
  assert.equal(s.basis, "MEASURED");
  assert.equal(s.minutes, 13);
});

test("implausible samples (instant clicks, 10-hour gaps) are ignored", () => {
  const s = rollingServiceTime([0.01, 0.02, 0.03, 500, 600], 10, cfg);
  assert.equal(s.basis, "BASELINE");
  const t = rollingServiceTime([0.01, 12, 14, 16, 900], 10, cfg);
  assert.equal(t.minutes, 14);
});

test("counters: smaller of staff and machines, or set by hand", () => {
  assert.equal(effectiveCounters(null, 4, 3), 3);
  assert.equal(effectiveCounters(null, 1, 8), 1);
  assert.equal(effectiveCounters(5, 4, 3), 5);
  assert.equal(effectiveCounters(0, 4, 3), 1); // never zero
});

test("spec example: 7 farmers ahead, 10 min each, one counter -> about 70 min, shown as a range", () => {
  const e = est(7 * 10, 1);
  assert.ok(e.startLowMin <= 70 && e.startHighMin >= 70);
  assert.ok(e.startHighMin > e.startLowMin);
  assert.equal(e.startLowMin, 55);
  assert.equal(e.startHighMin, 85);
});

test("two counters halve the wait", () => {
  const one = est(120, 1);
  const two = est(120, 2);
  assert.ok(two.startHighMin <= Math.ceil(one.startHighMin / 2) + 5);
  assert.ok(two.startLowMin < one.startLowMin);
});

test("more counters never make the wait longer", () => {
  let prev = Infinity;
  for (let c = 1; c <= 6; c++) {
    const e = est(180, c);
    assert.ok(e.startHighMin <= prev);
    prev = e.startHighMin;
  }
});

test("baseline estimates are wider than measured ones", () => {
  const m = est(100, 1);
  const b = est(100, 1, { basis: "BASELINE" });
  assert.ok(b.startHighMin - b.startLowMin > m.startHighMin - m.startLowMin);
});

test("time until processing starts is separate from total time to finish", () => {
  const e = est(60, 1);
  assert.ok(e.completeLowMin > e.startLowMin);
  assert.ok(e.completeHighMin > e.startHighMin);
});

test("nobody ahead -> processing starts at once", () => {
  const e = est(0, 2);
  assert.equal(e.startLowMin, 0);
  assert.equal(e.startHighMin, 0);
});

test("an officer-reported delay is added", () => {
  const a = est(60, 1);
  const b = est(60, 1, { delayMin: 30 });
  assert.ok(b.startLowMin >= a.startLowMin + 20);
});

test("a farmer part-way through counts for less work than one just arrived", () => {
  assert.ok(STAGE_REMAINING.WEIGHED < STAGE_REMAINING.QUALITY_CHECKED);
  assert.ok(STAGE_REMAINING.QUALITY_CHECKED < STAGE_REMAINING.VERIFIED);
  assert.ok(STAGE_REMAINING.VERIFIED < STAGE_REMAINING.ARRIVED);
  assert.equal(STAGE_REMAINING.COMPLETED, 0);
});

const base = { paused: false, delayMin: 0, serviceMin: 10, baselineMin: 10, basis: "MEASURED" as const, cfg: { lowMaxWaitMin: 20, moderateMaxWaitMin: 45, delayedFactor: 1.5 } };

test("status: low / moderate / high by wait for a new arrival", () => {
  assert.equal(classifyCentre({ ...base, newArrivalWaitMin: 10 }), "LOW");
  assert.equal(classifyCentre({ ...base, newArrivalWaitMin: 30 }), "MODERATE");
  assert.equal(classifyCentre({ ...base, newArrivalWaitMin: 90 }), "HIGH");
});

test("status: paused beats everything, delayed beats busy", () => {
  assert.equal(classifyCentre({ ...base, paused: true, newArrivalWaitMin: 90 }), "PAUSED");
  assert.equal(classifyCentre({ ...base, delayMin: 20, newArrivalWaitMin: 5 }), "DELAYED");
});

test("status: measured speed 1.5x slower than baseline -> delayed; baseline data is never called a delay", () => {
  assert.equal(classifyCentre({ ...base, serviceMin: 16, newArrivalWaitMin: 5 }), "DELAYED");
  assert.equal(classifyCentre({ ...base, basis: "BASELINE", serviceMin: 16, newArrivalWaitMin: 5 }), "LOW");
});

const hourly = (arrivals: number[], over: Partial<Parameters<typeof predictCongestion>[0]> = {}) =>
  predictCongestion({
    startQueue: 0,
    nowHour: 9,
    nowMinute: 0,
    endHour: 9 + arrivals.length,
    buckets: arrivals.map((expectedArrivals, i) => ({ hour: 9 + i, expectedArrivals })),
    showUpRate: 1,
    serviceMin: 10,
    counters: 2, // 12 farmers per hour
    delayMin: 0,
    cfg: { lowMaxWaitMin: 20, moderateMaxWaitMin: 45 },
    ...over,
  });

test("look-ahead: arrivals below capacity -> normal, queue stays empty", () => {
  const h = hourly([6, 6, 6]);
  assert.ok(h.every((x) => x.level === "NORMAL" && x.predictedQueue === 0 && !x.delayRisk));
});

test("look-ahead: arrivals above capacity build a queue that carries into the next hour", () => {
  const h = hourly([30, 0, 0]);
  assert.ok(h[0].delayRisk);
  assert.equal(h[0].predictedQueue, 18); // 30 arrive, 12 finished
  assert.equal(h[1].predictedQueue, 6); // 18 - 12
  assert.equal(h[2].predictedQueue, 0);
  assert.equal(h[0].level, "HIGH"); // 18 farmers x 10 min / 2 counters = 90 min
});

test("look-ahead: fewer counters -> a worse outlook for the same bookings", () => {
  const two = hourly([20, 20]);
  const one = hourly([20, 20], { counters: 1 });
  assert.ok(one[1].predictedWaitMin > two[1].predictedWaitMin);
});

test("look-ahead: only a share of booked farmers are expected (show-up rate)", () => {
  const h = hourly([20], { showUpRate: 0.5 });
  assert.equal(h[0].expectedArrivals, 10);
});

test("look-ahead: late farmers from past slot hours are counted in the current hour", () => {
  const h = predictCongestion({
    startQueue: 0, nowHour: 11, nowMinute: 0, endHour: 13,
    buckets: [{ hour: 9, expectedArrivals: 4 }, { hour: 12, expectedArrivals: 2 }],
    showUpRate: 1, serviceMin: 10, counters: 1, delayMin: 0, cfg: { lowMaxWaitMin: 20, moderateMaxWaitMin: 45 },
  });
  assert.equal(h[0].expectedArrivals, 4);
  assert.equal(h[1].expectedArrivals, 2);
});

test("look-ahead: late in the hour, less capacity is left in it", () => {
  const early = hourly([8], { nowMinute: 0 });
  const late = hourly([8], { nowMinute: 45 });
  assert.ok(late[0].capacityFarmers < early[0].capacityFarmers);
  assert.ok(late[0].predictedQueue > early[0].predictedQueue);
});

console.log(`\n${passed} tests passed.`);
