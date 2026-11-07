// Small shared helpers for the emergency screens (farmer and officer).

import type { EmergencyCategory, EmergencyStatus, VerificationResult, WeatherReason } from "../types";

export const CATEGORIES: EmergencyCategory[] = ["HEAVY_RAINFALL", "FLOODING", "SEVERE_WEATHER", "ROAD_BLOCKAGE", "OTHER"];

export const STATUS_STYLE: Record<EmergencyStatus, string> = {
  SUBMITTED: "bg-sky/10 text-sky",
  UNDER_VERIFICATION: "bg-sky/10 text-sky",
  AWAITING_REVIEW: "bg-wheat-light/50 text-soil",
  APPROVED: "bg-field/10 text-field",
  REJECTED: "bg-red-50 text-red-600",
  RESCHEDULING_AVAILABLE: "bg-field/10 text-field",
  RESCHEDULED: "bg-field/10 text-field",
};

export const OUTCOME_STYLE: Record<VerificationResult, string> = {
  STRONGLY_CORROBORATED: "bg-field/10 text-field",
  PARTIALLY_CORROBORATED: "bg-wheat-light/50 text-soil",
  UNABLE_TO_VERIFY: "bg-soil-light/15 text-soil",
  CONTRADICTORY: "bg-red-50 text-red-600",
};

// Which step of the tracker a status belongs to (0-4).
export function trackerStep(status: EmergencyStatus): number {
  switch (status) {
    case "SUBMITTED": return 0;
    case "UNDER_VERIFICATION": return 1;
    case "AWAITING_REVIEW": return 2;
    case "APPROVED":
    case "REJECTED":
    case "RESCHEDULING_AVAILABLE": return 3;
    default: return 4;
  }
}

// "2026-07-10T00:00:00.000Z" -> "10/07/2026"
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "UTC" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// The value a <input type="datetime-local"> expects, in the browser's own time.
export function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Turns a stored reason ({code, params}) into a sentence in the viewer's language.
// `t` is the app's translate function; it only knows fixed keys, so the dynamic key is passed through `any`.
export function reasonText(r: WeatherReason, t: (key: any) => string): string {
  let text = t(`emg.reason.${r.code}`);
  if (text.startsWith("emg.reason.")) return r.code; // unknown code: show it plainly
  for (const [key, value] of Object.entries(r.params ?? {})) {
    const shown = key === "place" ? t(`emg.place.${value}`) : String(value);
    text = text.split(`{${key}}`).join(shown);
  }
  return text;
}
