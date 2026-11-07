// The "does the weather data support this claim?" engine.
//
// It is plain logic: numbers in, a result out. No database, no network, so it
// can be tested on its own (npm run test:emergency).
//
// Honest limits, built into the rules:
//   - Weather data can only support a WEATHER claim. It cannot prove that one
//     person could not travel.
//   - A sunny procurement centre is NOT proof that a claim is false, and
//     rain somewhere nearby is NOT proof that it is true.
//   - "No data" never counts against the farmer.
//   - The result is ADVICE for an officer. Nothing is approved or rejected
//     automatically.

import { emergencyConfig } from "../config/emergency";
import { PointLabel, PointObservation, WeatherFetchResult } from "./weather/types";

export type Category = "HEAVY_RAINFALL" | "FLOODING" | "SEVERE_WEATHER" | "ROAD_BLOCKAGE" | "OTHER";
export type Outcome = "STRONGLY_CORROBORATED" | "PARTIALLY_CORROBORATED" | "UNABLE_TO_VERIFY" | "CONTRADICTORY";

// A language-neutral reason. The screen turns `code` + `params` into a sentence.
export interface Reason {
  code: string;
  params?: Record<string, string | number>;
}

export interface PointSummary {
  label: PointLabel;
  lat: number; // rounded to 2 decimals
  lng: number;
  dataAvailable: boolean;
  error?: string;
  hoursCovered: number;
  forecastHours: number; // hours in the window that are still in the future (forecast, not observation)
  rainTotalMm: number;
  rain24hMaxMm: number;
  rainPeakHourMm: number;
  windMaxKph: number;
  gustMaxKph: number;
  rainLevel: "NONE" | "LIGHT" | "MODERATE" | "SIGNIFICANT";
  strongWind: boolean;
  alerts: { headline: string; event?: string; severity?: string }[];
}

export interface EngineInput {
  category: Category;
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  hasFarmerLocation: boolean;
  evidenceCount: number;
  descriptionLength: number;
  weather: WeatherFetchResult;
  previousClaims: number; // this farmer's earlier requests in the last 90 days
}

export interface EngineResult {
  outcome: Outcome;
  supportScore: number; // 0-100: how much supporting information exists. NOT a probability.
  reasons: Reason[];
  flagReason: string | null; // comma-separated codes, or null
  observations: PointSummary[];
}

const HOUR = 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarisePoint(obs: PointObservation, startMs: number, endMs: number, nowMs: number): PointSummary {
  const cfg = emergencyConfig();
  const hours = obs.hours
    .filter((h) => h.endMs >= startMs && h.endMs <= endMs + HOUR)
    .sort((a, b) => a.endMs - b.endMs);
  const withRain = hours.filter((h) => h.precipMm !== null);

  const rainTotal = withRain.reduce((n, h) => n + (h.precipMm ?? 0), 0);
  const peak = withRain.reduce((n, h) => Math.max(n, h.precipMm ?? 0), 0);
  // Heaviest 24 hours inside the window.
  let rain24 = 0;
  for (const h of withRain) {
    const sum = withRain
      .filter((x) => x.endMs > h.endMs - 24 * HOUR && x.endMs <= h.endMs)
      .reduce((n, x) => n + (x.precipMm ?? 0), 0);
    rain24 = Math.max(rain24, sum);
  }
  const wind = hours.reduce((n, h) => Math.max(n, h.windKph ?? 0), 0);
  const gust = hours.reduce((n, h) => Math.max(n, h.gustKph ?? 0), 0);

  let rainLevel: PointSummary["rainLevel"] = "NONE";
  if (rain24 >= cfg.rainSignificantMm24h || peak >= cfg.rainSignificantMmHour) rainLevel = "SIGNIFICANT";
  else if (rain24 >= cfg.rainModerateMm24h) rainLevel = "MODERATE";
  else if (rainTotal >= cfg.rainDryMm) rainLevel = "LIGHT";

  // Only alerts that overlap the window count.
  const alerts = obs.alerts
    .filter((a) => (a.effectiveMs === undefined || a.effectiveMs <= endMs) && (a.expiresMs === undefined || a.expiresMs >= startMs))
    .map((a) => ({ headline: a.headline, event: a.event, severity: a.severity }));

  return {
    label: obs.point.label,
    lat: round2(obs.point.lat),
    lng: round2(obs.point.lng),
    dataAvailable: withRain.length > 0,
    error: obs.error,
    hoursCovered: hours.length,
    forecastHours: hours.filter((h) => h.endMs > nowMs).length,
    rainTotalMm: round1(rainTotal),
    rain24hMaxMm: round1(rain24),
    rainPeakHourMm: round1(peak),
    windMaxKph: Math.round(wind),
    gustMaxKph: Math.round(gust),
    rainLevel,
    strongWind: gust >= cfg.strongGustKph,
    alerts,
  };
}

const WEATHER_CATEGORIES: Category[] = ["HEAVY_RAINFALL", "FLOODING", "SEVERE_WEATHER"];
const LEVEL_RANK = { NONE: 0, LIGHT: 1, MODERATE: 2, SIGNIFICANT: 3 } as const;

// How strongly does THIS place's weather match THIS kind of claim?
function claimLevel(category: Category, p: PointSummary): "NONE" | "MODERATE" | "SIGNIFICANT" {
  let level: "NONE" | "MODERATE" | "SIGNIFICANT" = "NONE";
  if (p.rainLevel === "SIGNIFICANT") level = "SIGNIFICANT";
  else if (p.rainLevel === "MODERATE") level = "MODERATE";
  if (category === "SEVERE_WEATHER" || category === "ROAD_BLOCKAGE") {
    if (p.strongWind || p.alerts.length > 0) level = "SIGNIFICANT";
  }
  return level;
}

export function evaluateClaim(input: EngineInput): EngineResult {
  const cfg = emergencyConfig();
  const reasons: Reason[] = [];
  const flags: string[] = [];
  const summaries = input.weather.points.map((p) => summarisePoint(p, input.windowStartMs, input.windowEndMs, input.nowMs));
  const withData = summaries.filter((s) => s.dataAvailable);
  const weatherRelevant = input.category !== "OTHER";

  // ----- the parts that do not depend on weather -----
  let score = 0;
  if (input.evidenceCount > 0) {
    score += 25;
    reasons.push({ code: "evidenceProvided", params: { n: input.evidenceCount } });
  } else {
    reasons.push({ code: "noEvidence" });
  }
  if (input.descriptionLength >= 30) score += 5;
  if (input.hasFarmerLocation) {
    score += 5;
    reasons.push({ code: "locationProvided" });
  } else if (weatherRelevant) {
    reasons.push({ code: "noLocation" });
  }

  if (input.previousClaims >= cfg.repeatClaimLimit) {
    flags.push("repeatClaims");
    reasons.push({ code: "repeatClaims", params: { n: input.previousClaims } });
  }

  const finish = (outcome: Outcome): EngineResult => ({
    outcome,
    supportScore: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    flagReason: flags.length ? flags.join(",") : null,
    observations: summaries,
  });

  // ----- categories weather cannot speak to -----
  if (!weatherRelevant) {
    reasons.push({ code: "weatherNotApplicable" });
    return finish(input.evidenceCount > 0 ? "PARTIALLY_CORROBORATED" : "UNABLE_TO_VERIFY");
  }

  // ----- no weather data at all: never counts against the farmer -----
  if (withData.length === 0) {
    const src = input.weather.source;
    reasons.push({ code: src === "NOT_CONFIGURED" ? "weatherNotConfigured" : src === "UNAVAILABLE" ? "weatherUnavailable" : "noWeatherData" });
    return finish("UNABLE_TO_VERIFY");
  }

  reasons.push({ code: "weatherSource", params: { provider: input.weather.provider } });
  if (withData.some((s) => s.forecastHours > 0)) {
    reasons.push({ code: "forecastUsed", params: { hours: Math.max(...withData.map((s) => s.forecastHours)) } });
  }

  // ----- weather support -----
  const near = summaries.filter((s) => s.label === "farmer" || s.label === "route");
  const around = summaries.filter((s) => s.label === "centre" || s.label === "area");
  const levelOf = (s: PointSummary) => (s.dataAvailable || s.alerts.length > 0 ? claimLevel(input.category, s) : "NONE");
  const nearSig = near.find((s) => levelOf(s) === "SIGNIFICANT");
  const aroundSig = around.find((s) => levelOf(s) === "SIGNIFICANT");
  const nearMod = near.find((s) => levelOf(s) === "MODERATE");
  const aroundMod = around.find((s) => levelOf(s) === "MODERATE");

  let weatherScore = 0;
  const describe = (s: PointSummary, level: "SIGNIFICANT" | "MODERATE") => {
    if (s.rainLevel === level) {
      reasons.push({
        code: level === "SIGNIFICANT" ? "rainSignificant" : "rainModerate",
        params: { place: s.label, mm24: s.rain24hMaxMm, peak: s.rainPeakHourMm },
      });
    }
    if (s.strongWind && (input.category === "SEVERE_WEATHER" || input.category === "ROAD_BLOCKAGE")) {
      reasons.push({ code: "windStrong", params: { place: s.label, gust: s.gustMaxKph } });
    }
  };
  if (nearSig) {
    weatherScore += 45;
    describe(nearSig, "SIGNIFICANT");
  } else if (aroundSig) {
    weatherScore += 30;
    describe(aroundSig, "SIGNIFICANT");
    reasons.push({ code: "supportAtCentreOnly" });
  } else if (nearMod) {
    weatherScore += 15;
    describe(nearMod, "MODERATE");
  } else if (aroundMod) {
    weatherScore += 10;
    describe(aroundMod, "MODERATE");
  }

  const alertPoints = summaries.filter((s) => s.alerts.length > 0);
  if (alertPoints.length > 0) {
    weatherScore += 15;
    reasons.push({ code: "alertFound", params: { count: alertPoints.reduce((n, s) => n + s.alerts.length, 0), headline: alertPoints[0].alerts[0].headline } });
  }
  score += Math.min(60, weatherScore);

  // ----- contradiction: only when the farmer's OWN reported place has data and is dry -----
  const farmerPoint = summaries.find((s) => s.label === "farmer");
  const dryEverywhere = withData.every((s) => s.rainTotalMm < cfg.rainDryMm && !s.strongWind && s.alerts.length === 0);
  if (WEATHER_CATEGORIES.includes(input.category) && farmerPoint?.dataAvailable && dryEverywhere) {
    flags.push("contradictory");
    reasons.push({ code: "dryAtReportedLocation", params: { mm: farmerPoint.rainTotalMm } });
    return finish("CONTRADICTORY");
  }
  if (weatherScore === 0) {
    // Dry or light weather but we cannot tell where the farmer was, so it is not proof of anything.
    reasons.push({ code: "noWeatherSupport" });
  }

  // ----- outcome -----
  if (score >= 70 && input.evidenceCount > 0) return finish("STRONGLY_CORROBORATED");
  if (score >= 70) reasons.push({ code: "needsEvidence" });
  if (score >= 35) return finish("PARTIALLY_CORROBORATED");
  return finish("UNABLE_TO_VERIFY");
}
