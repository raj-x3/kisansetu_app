// Run with: npm run test:weather
// Checks the weather providers' reading of an answer and the full chain
// "answer -> verification result", using a stand-in for the internet.
// The numbers below are test inputs shaped like Open-Meteo's documented
// answer. The app never uses them: real requests always go to the real service.

import assert from "node:assert/strict";
import { fetchWeather } from "../src/services/weather/providers";
import { evaluateClaim } from "../src/services/emergencyVerification";
import { GeoPoint } from "../src/services/weather/types";

const HOUR = 3_600_000;
const realFetch = globalThis.fetch;
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// An Open-Meteo style answer: one object per place, hours as unix seconds (end of hour).
function openMeteoAnswer(nowMs: number, mmPerHour: number[], gust = 20) {
  const start = Math.floor(nowMs / HOUR) * HOUR - 47 * HOUR;
  const time: number[] = [];
  const precipitation: number[] = [];
  for (let i = 0; i < 72; i++) {
    time.push((start + i * HOUR) / 1000);
    precipitation.push(mmPerHour[i % mmPerHour.length]);
  }
  return {
    hourly: {
      time,
      precipitation,
      wind_speed_10m: time.map(() => 12),
      wind_gusts_10m: time.map(() => gust),
    },
  };
}

function mockFetch(handler: (url: string) => unknown | Error) {
  (globalThis as any).fetch = async (url: string) => {
    const out = handler(String(url));
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, json: async () => out } as any;
  };
}

const NOW = Date.now();
const points: GeoPoint[] = [
  { label: "farmer", lat: 29.5, lng: 76.9 },
  { label: "centre", lat: 29.69, lng: 76.99 },
  { label: "route", lat: 29.6, lng: 76.95 },
];

(async () => {
  process.env.WEATHER_PROVIDER = "open-meteo";

  await test("Scenario 1: heavy rain around the farmer -> strongly corroborated", async () => {
    mockFetch((url) => {
      assert.ok(url.includes("latitude=29.500,29.690,29.600"), "all three places are asked in ONE call");
      assert.ok(url.includes("timeformat=unixtime"));
      return [openMeteoAnswer(NOW, [6]), openMeteoAnswer(NOW, [0]), openMeteoAnswer(NOW, [4])];
    });
    const w = await fetchWeather(points, NOW - 12 * HOUR, NOW);
    assert.equal(w.source, "LIVE");
    assert.equal(w.points.length, 3);
    const r = evaluateClaim({
      category: "HEAVY_RAINFALL", windowStartMs: NOW - 12 * HOUR, windowEndMs: NOW, nowMs: NOW,
      hasFarmerLocation: true, evidenceCount: 1, descriptionLength: 50, weather: w, previousClaims: 0,
    });
    // The centre itself was dry, yet the farmer's own place was soaked: the claim stands.
    assert.equal(r.outcome, "STRONGLY_CORROBORATED");
  });

  await test("Scenario 2: weather service unreachable -> unable to verify, never rejected", async () => {
    mockFetch(() => new Error("network down"));
    const w = await fetchWeather(points, NOW - 12 * HOUR, NOW);
    assert.equal(w.source, "UNAVAILABLE");
    const r = evaluateClaim({
      category: "HEAVY_RAINFALL", windowStartMs: NOW - 12 * HOUR, windowEndMs: NOW, nowMs: NOW,
      hasFarmerLocation: true, evidenceCount: 1, descriptionLength: 50, weather: w, previousClaims: 0,
    });
    assert.equal(r.outcome, "UNABLE_TO_VERIFY");
    assert.ok(r.reasons.some((x) => x.code === "weatherUnavailable"));
  });

  await test("Scenario 4: dry at the farmer's reported place -> contradictory and flagged", async () => {
    mockFetch(() => [openMeteoAnswer(NOW, [0]), openMeteoAnswer(NOW, [0]), openMeteoAnswer(NOW, [0])]);
    const w = await fetchWeather(points, NOW - 12 * HOUR, NOW);
    const r = evaluateClaim({
      category: "FLOODING", windowStartMs: NOW - 12 * HOUR, windowEndMs: NOW, nowMs: NOW,
      hasFarmerLocation: true, evidenceCount: 0, descriptionLength: 50, weather: w, previousClaims: 0,
    });
    assert.equal(r.outcome, "CONTRADICTORY");
    assert.ok(r.flagReason?.includes("contradictory"));
  });

  await test("only hours inside the window are used", async () => {
    mockFetch(() => [openMeteoAnswer(NOW, [9]), openMeteoAnswer(NOW, [9]), openMeteoAnswer(NOW, [9])]);
    const w = await fetchWeather(points, NOW - 3 * HOUR, NOW);
    for (const p of w.points) {
      assert.ok(p.hours.length > 0 && p.hours.length <= 5, `hours kept: ${p.hours.length}`);
      assert.ok(p.hours.every((h) => h.endMs >= NOW - 3 * HOUR && h.endMs <= NOW + HOUR));
    }
  });

  await test("a single-place answer (object, not array) is read too", async () => {
    mockFetch(() => openMeteoAnswer(NOW, [2]));
    const w = await fetchWeather([points[1]], NOW - 6 * HOUR, NOW);
    assert.equal(w.source, "LIVE");
    assert.ok(w.points[0].hours.length > 0);
  });

  await test("provider 'none' says so plainly and fetches nothing", async () => {
    process.env.WEATHER_PROVIDER = "none";
    let called = false;
    mockFetch(() => { called = true; return {}; });
    const w = await fetchWeather(points, NOW - 6 * HOUR, NOW);
    assert.equal(w.source, "NOT_CONFIGURED");
    assert.equal(called, false);
    process.env.WEATHER_PROVIDER = "open-meteo";
  });

  await test("weatherapi without a key is reported as not configured (no request sent)", async () => {
    process.env.WEATHER_PROVIDER = "weatherapi";
    delete process.env.WEATHER_API_KEY;
    let called = false;
    mockFetch(() => { called = true; return {}; });
    const w = await fetchWeather(points, NOW - 6 * HOUR, NOW);
    assert.equal(w.source, "NOT_CONFIGURED");
    assert.equal(called, false);
    process.env.WEATHER_PROVIDER = "open-meteo";
  });

  (globalThis as any).fetch = realFetch;
  console.log(`\n${passed} tests passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
