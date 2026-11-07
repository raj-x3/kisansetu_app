// Real weather lookups. No invented data anywhere in this file:
//   - "open-meteo": free, no key. Hourly rainfall and wind from a weather
//     model that is re-calculated from observations, for the recent past and
//     the next days. It has NO government warnings.
//   - "weatherapi": needs WEATHER_API_KEY (kept on the server only). Hourly
//     history and forecast, plus official alerts where the provider has them.
//   - "none" (or a missing key): nothing is fetched. The result says
//     NOT_CONFIGURED so the officer sees plainly that no weather check ran.
// If a provider cannot be reached, the result says UNAVAILABLE. Nothing is
// ever guessed. OpenWeather's free plan has no history, so it is not offered.

import { emergencyConfig } from "../../config/emergency";
import { GeoPoint, PointObservation, WeatherFetchResult, HourSample, WeatherAlert } from "./types";

const TIMEOUT_MS = 9000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------- Open-Meteo ----------

async function fetchOpenMeteo(points: GeoPoint[], startMs: number, endMs: number): Promise<WeatherFetchResult> {
  const now = Date.now();
  const pastDays = Math.min(92, Math.max(0, Math.ceil((now - startMs) / DAY_MS) + 1));
  const forecastDays = Math.min(16, Math.max(1, Math.ceil((endMs - now) / DAY_MS) + 1));
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${points.map((p) => p.lat.toFixed(3)).join(",")}` +
    `&longitude=${points.map((p) => p.lng.toFixed(3)).join(",")}` +
    "&hourly=precipitation,wind_speed_10m,wind_gusts_10m" +
    `&past_days=${pastDays}&forecast_days=${forecastDays}&timeformat=unixtime`;

  let json: any;
  try {
    json = await getJson(url);
  } catch (err) {
    return {
      provider: "open-meteo",
      source: "UNAVAILABLE",
      dataKind: "NONE",
      note: err instanceof Error ? err.message : "Could not reach the weather service.",
      points: points.map((point) => ({ point, hours: [], alerts: [], error: "unreachable" })),
    };
  }

  const list: any[] = Array.isArray(json) ? json : [json];
  const out: PointObservation[] = points.map((point, i) => {
    const h = list[i]?.hourly;
    if (!h || !Array.isArray(h.time)) return { point, hours: [], alerts: [], error: "no data" };
    const hours: HourSample[] = [];
    for (let k = 0; k < h.time.length; k++) {
      const endSec = h.time[k];
      if (typeof endSec !== "number") continue;
      const endMsHour = endSec * 1000;
      // Keep only hours that touch our window.
      if (endMsHour < startMs || endMsHour > endMs + HOUR_MS) continue;
      hours.push({
        endMs: endMsHour,
        precipMm: numOrNull(h.precipitation?.[k]),
        windKph: numOrNull(h.wind_speed_10m?.[k]),
        gustKph: numOrNull(h.wind_gusts_10m?.[k]),
      });
    }
    return { point, hours, alerts: [] };
  });
  return {
    provider: "open-meteo",
    source: out.some((p) => p.hours.length > 0) ? "LIVE" : "UNAVAILABLE",
    dataKind: "MODEL_ANALYSIS",
    note: "Open-Meteo model data (not a weather-station reading). It carries no official government warnings.",
    points: out,
  };
}

// ---------- WeatherAPI.com ----------
// The field names below follow WeatherAPI's public JSON. Every field is read
// defensively, so a missing one gives "no data", never a wrong number.

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchWeatherApi(points: GeoPoint[], startMs: number, endMs: number, apiKey: string): Promise<WeatherFetchResult> {
  const now = Date.now();
  // WeatherAPI is called once per place and day, so only the two most important places are checked.
  const used = points.slice(0, 2);
  const todayStr = utcDate(now);
  const pastDates: string[] = [];
  for (let t = startMs; t <= Math.min(endMs, now); t += DAY_MS) {
    const d = utcDate(t);
    if (d < todayStr && !pastDates.includes(d)) pastDates.push(d);
  }
  if (utcDate(Math.min(endMs, now)) < todayStr && !pastDates.includes(utcDate(Math.min(endMs, now)))) {
    pastDates.push(utcDate(Math.min(endMs, now)));
  }
  const dates = pastDates.slice(-3);

  const observations: PointObservation[] = await Promise.all(
    used.map(async (point): Promise<PointObservation> => {
      const q = `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
      const hours: HourSample[] = [];
      const alerts: WeatherAlert[] = [];
      try {
        const collect = (json: any) => {
          for (const day of json?.forecast?.forecastday ?? []) {
            for (const hr of day?.hour ?? []) {
              if (typeof hr?.time_epoch !== "number") continue;
              const endMsHour = hr.time_epoch * 1000 + HOUR_MS;
              if (endMsHour < startMs || endMsHour > endMs + HOUR_MS) continue;
              hours.push({
                endMs: endMsHour,
                precipMm: numOrNull(hr.precip_mm),
                windKph: numOrNull(hr.wind_kph),
                gustKph: numOrNull(hr.gust_kph),
              });
            }
          }
        };
        for (const d of dates) {
          collect(await getJson(`https://api.weatherapi.com/v1/history.json?key=${encodeURIComponent(apiKey)}&q=${q}&dt=${d}`));
        }
        // Today and the coming days, plus official alerts.
        if (endMs >= now - DAY_MS) {
          const days = Math.min(3, Math.max(1, Math.ceil((endMs - now) / DAY_MS) + 1));
          const fc = await getJson(`https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(apiKey)}&q=${q}&days=${days}&alerts=yes`);
          collect(fc);
          for (const a of fc?.alerts?.alert ?? []) {
            if (typeof a?.headline !== "string" && typeof a?.event !== "string") continue;
            alerts.push({
              headline: String(a.headline ?? a.event).slice(0, 200),
              event: typeof a.event === "string" ? a.event.slice(0, 80) : undefined,
              severity: typeof a.severity === "string" ? a.severity.slice(0, 40) : undefined,
              effectiveMs: a.effective ? Date.parse(a.effective) || undefined : undefined,
              expiresMs: a.expires ? Date.parse(a.expires) || undefined : undefined,
            });
          }
        }
        hours.sort((a, b) => a.endMs - b.endMs);
        return { point, hours, alerts };
      } catch (err) {
        return { point, hours: [], alerts: [], error: err instanceof Error ? err.message : "failed" };
      }
    })
  );
  return {
    provider: "weatherapi",
    source: observations.some((p) => p.hours.length > 0) ? "LIVE" : "UNAVAILABLE",
    dataKind: "STATION_OR_MODEL",
    note: "WeatherAPI.com data, including official alerts where the provider has them.",
    points: observations,
  };
}

// ---------- Entry point ----------

export async function fetchWeather(points: GeoPoint[], startMs: number, endMs: number): Promise<WeatherFetchResult> {
  const cfg = emergencyConfig();
  if (cfg.provider === "open-meteo") return fetchOpenMeteo(points, startMs, endMs);
  if (cfg.provider === "weatherapi") {
    if (!cfg.apiKey) {
      return notConfigured("weatherapi", "WEATHER_PROVIDER is weatherapi but WEATHER_API_KEY is not set.", points);
    }
    return fetchWeatherApi(points, startMs, endMs, cfg.apiKey);
  }
  return notConfigured("none", "No weather source is configured (WEATHER_PROVIDER). No weather check was done.", points);
}

function notConfigured(provider: string, note: string, points: GeoPoint[]): WeatherFetchResult {
  return {
    provider,
    source: "NOT_CONFIGURED",
    dataKind: "NONE",
    note,
    points: points.map((point) => ({ point, hours: [], alerts: [] })),
  };
}

// ---------- Place name -> coordinates (used once per centre) ----------

export async function geocodePlace(name: string, state?: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const json = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&countryCode=IN&language=en`
    );
    const results: any[] = Array.isArray(json?.results) ? json.results : [];
    if (results.length === 0) return null;
    const wanted = (state ?? "").trim().toLowerCase();
    const best = results.find((r) => wanted && String(r.admin1 ?? "").toLowerCase() === wanted) ?? results[0];
    if (typeof best.latitude !== "number" || typeof best.longitude !== "number") return null;
    return { lat: best.latitude, lng: best.longitude };
  } catch {
    return null;
  }
}
