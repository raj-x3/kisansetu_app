// Small helpers shared by the live-queue and waitlist screens.

import { useEffect, useState } from "react";
import type { QueueLevel } from "../types";

export const LEVEL_STYLE: Record<QueueLevel, { dot: string; text: string; bg: string; key: string }> = {
  LOW: { dot: "bg-field", text: "text-field", bg: "bg-field/10", key: "q.level.LOW" },
  MODERATE: { dot: "bg-wheat-dark", text: "text-wheat-dark", bg: "bg-wheat-light/40", key: "q.level.MODERATE" },
  HIGH: { dot: "bg-red-500", text: "text-red-600", bg: "bg-red-50", key: "q.level.HIGH" },
  DELAYED: { dot: "bg-orange-500", text: "text-orange-600", bg: "bg-orange-50", key: "q.level.DELAYED" },
  PAUSED: { dot: "bg-soil-light", text: "text-soil", bg: "bg-soil-light/15", key: "q.level.PAUSED" },
};

// "20–30 min", or "now" when nobody is ahead.
export function rangeText(low: number, high: number, t: (key: any) => string): string {
  if (high <= 0) return t("q.now");
  return t("q.range").replace("{low}", String(low)).replace("{high}", String(high));
}

// Re-renders every `ms`, so countdowns tick without any server call.
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function countdown(expiresAtIso: string, now: number): { text: string; over: boolean } {
  const left = Math.max(0, new Date(expiresAtIso).getTime() - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { text: `${m}:${String(s).padStart(2, "0")}`, over: left <= 0 };
}

export function shortDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}
