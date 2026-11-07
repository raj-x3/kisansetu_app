// Run with: npm run test:emergency
// Checks the emergency verification rules with prepared weather numbers.
// No database and no internet needed. These are test inputs for the rules,
// not weather data the app ever uses.

import assert from "node:assert/strict";
import { evaluateClaim, EngineInput } from "../src/services/emergencyVerification";
import { PointObservation, WeatherFetchResult, PointLabel } from "../src/services/weather/types";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 6, 10, 12, 0);
const START = NOW - 24 * HOUR;
const END = NOW;

function point(label: PointLabel, mmPerHour: number, extra: Partial<PointObservation> = {}): PointObservation {
  const hours = [];
  for (let i = 1; i <= 24; i++) hours.push({ endMs: START + i * HOUR, precipMm: mmPerHour, windKph: 10, gustKph: 20 });
  return { point: { label, lat: 29.7, lng: 76.9 }, hours, alerts: [], ...extra };
}
function weather(points: PointObservation[], source: WeatherFetchResult["source"] = "LIVE"): WeatherFetchResult {
  return { provider: "test", source, dataKind: "MODEL_ANALYSIS", points };
}
function input(over: Partial<EngineInput>): EngineInput {
  return {
    category: "HEAVY_RAINFALL",
    windowStartMs: START,
    windowEndMs: END,
    nowMs: NOW,
    hasFarmerLocation: true,
    evidenceCount: 1,
    descriptionLength: 60,
    weather: weather([point("farmer", 4), point("centre", 4)]),
    previousClaims: 0,
    ...over,
  };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

test("heavy rain at the farmer's place + evidence -> strongly corroborated", () => {
  const r = evaluateClaim(input({}));
  assert.equal(r.outcome, "STRONGLY_CORROBORATED");
  assert.ok(r.supportScore >= 70);
});

test("heavy rain but NO evidence is never 'strong'", () => {
  const r = evaluateClaim(input({ evidenceCount: 0 }));
  assert.equal(r.outcome, "PARTIALLY_CORROBORATED");
});

test("rain only at the centre, farmer location unknown -> partial, not strong", () => {
  const r = evaluateClaim(input({ hasFarmerLocation: false, weather: weather([point("centre", 4), point("area", 0)]) }));
  assert.equal(r.outcome, "PARTIALLY_CORROBORATED");
  assert.ok(r.reasons.some((x) => x.code === "supportAtCentreOnly"));
});

test("no weather source configured -> unable to verify, with a plain reason", () => {
  const r = evaluateClaim(input({ weather: weather([point("centre", 0, { hours: [] })], "NOT_CONFIGURED") }));
  assert.equal(r.outcome, "UNABLE_TO_VERIFY");
  assert.ok(r.reasons.some((x) => x.code === "weatherNotConfigured"));
});

test("weather service down -> unable to verify (never a rejection)", () => {
  const r = evaluateClaim(input({ weather: weather([point("centre", 0, { hours: [], error: "unreachable" })], "UNAVAILABLE") }));
  assert.equal(r.outcome, "UNABLE_TO_VERIFY");
  assert.ok(r.reasons.some((x) => x.code === "weatherUnavailable"));
});

test("dry at the farmer's own reported place -> contradictory and flagged", () => {
  const r = evaluateClaim(input({ weather: weather([point("farmer", 0), point("centre", 0)]) }));
  assert.equal(r.outcome, "CONTRADICTORY");
  assert.ok(r.flagReason?.includes("contradictory"));
});

test("a sunny centre alone does NOT disprove a claim when the farmer's place is unknown", () => {
  const r = evaluateClaim(input({ hasFarmerLocation: false, weather: weather([point("centre", 0), point("area", 0)]) }));
  assert.notEqual(r.outcome, "CONTRADICTORY");
  assert.equal(r.outcome, "UNABLE_TO_VERIFY");
});

test("sunny centre but heavy rain at the farmer's place still supports the claim", () => {
  const r = evaluateClaim(input({ weather: weather([point("farmer", 4), point("centre", 0)]) }));
  assert.equal(r.outcome, "STRONGLY_CORROBORATED");
});

test("'other' emergencies are never corroborated by weather alone", () => {
  const a = evaluateClaim(input({ category: "OTHER", evidenceCount: 0 }));
  assert.equal(a.outcome, "UNABLE_TO_VERIFY");
  const b = evaluateClaim(input({ category: "OTHER", evidenceCount: 2 }));
  assert.equal(b.outcome, "PARTIALLY_CORROBORATED");
});

test("an official alert supports a severe-weather claim", () => {
  const w = weather([point("farmer", 0, { alerts: [{ headline: "Thunderstorm warning", effectiveMs: START, expiresMs: END }] }), point("centre", 0)]);
  const r = evaluateClaim(input({ category: "SEVERE_WEATHER", weather: w }));
  assert.ok(["STRONGLY_CORROBORATED", "PARTIALLY_CORROBORATED"].includes(r.outcome));
  assert.ok(r.reasons.some((x) => x.code === "alertFound"));
});

test("an alert that ended before the window is ignored", () => {
  const w = weather([point("farmer", 0, { alerts: [{ headline: "Old warning", effectiveMs: START - 10 * HOUR, expiresMs: START - 5 * HOUR }] })]);
  const r = evaluateClaim(input({ category: "SEVERE_WEATHER", weather: w }));
  assert.ok(!r.reasons.some((x) => x.code === "alertFound"));
});

test("repeated claims are flagged for extra review", () => {
  const r = evaluateClaim(input({ previousClaims: 3 }));
  assert.ok(r.flagReason?.includes("repeatClaims"));
});

test("a blocked road in dry weather is not called contradictory", () => {
  const r = evaluateClaim(input({ category: "ROAD_BLOCKAGE", weather: weather([point("farmer", 0), point("centre", 0)]) }));
  assert.notEqual(r.outcome, "CONTRADICTORY");
});

test("the score always stays between 0 and 100", () => {
  const r = evaluateClaim(input({ previousClaims: 9, descriptionLength: 500, evidenceCount: 6 }));
  assert.ok(r.supportScore >= 0 && r.supportScore <= 100);
});

console.log(`\n${passed} tests passed.`);
