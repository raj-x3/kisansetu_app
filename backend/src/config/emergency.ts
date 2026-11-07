// Settings for emergency cancellation. Every number can be changed with an
// environment variable, so nothing here is baked into the code. The weather
// thresholds are APP SETTINGS to help an officer, not official IMD or
// government classifications.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function emergencyConfig() {
  return {
    // Which weather source to use: "open-meteo" (free, no key), "weatherapi" (needs WEATHER_API_KEY) or "none".
    provider: (process.env.WEATHER_PROVIDER ?? "open-meteo").trim().toLowerCase(),
    apiKey: process.env.WEATHER_API_KEY ?? "",
    // A farmer may still send an emergency request up to this many hours AFTER the slot ended
    // (the "emergency exception": they could not reach the centre in time).
    lateWindowHours: num("EMERGENCY_LATE_WINDOW_HOURS", 24),
    // An emergency may be reported up to this many hours BEFORE the slot (for example a storm warning).
    earlyWindowHours: num("EMERGENCY_EARLY_WINDOW_HOURS", 72),
    // Centres are in India. Slot times are local time; this converts them to UTC for the weather lookup.
    centreUtcOffsetMinutes: num("CENTRE_UTC_OFFSET_MINUTES", 330),
    // Rainfall levels used to describe the weather data to the officer.
    rainSignificantMm24h: num("WEATHER_RAIN_SIGNIFICANT_MM_24H", 50),
    rainSignificantMmHour: num("WEATHER_RAIN_SIGNIFICANT_MM_HOUR", 10),
    rainModerateMm24h: num("WEATHER_RAIN_MODERATE_MM_24H", 20),
    rainDryMm: num("WEATHER_RAIN_DRY_MM", 2),
    strongGustKph: num("WEATHER_GUST_STRONG_KPH", 60),
    // A farmer with this many earlier emergency requests in the last 90 days is flagged for extra review.
    repeatClaimLimit: num("EMERGENCY_REPEAT_CLAIM_LIMIT", 2),
    // Rate limits: attempts per farmer per hour.
    submitPerHour: num("EMERGENCY_SUBMIT_PER_HOUR", 5),
    actionPerHour: num("EMERGENCY_ACTION_PER_HOUR", 30),
    // How many days ahead rescheduling options are searched, and how many are shown.
    rescheduleLookaheadDays: num("EMERGENCY_RESCHEDULE_LOOKAHEAD_DAYS", 7),
    rescheduleMaxOptions: num("EMERGENCY_RESCHEDULE_MAX_OPTIONS", 8),
  };
}

export const MAX_EVIDENCE_PER_REQUEST = 6;
export const MAX_EVIDENCE_AT_SUBMIT = 3;
// The JSON body limit is 4 MB, and base64 text is about a third bigger than the file.
export const MAX_EVIDENCE_TOTAL_BYTES_PER_CALL = 2_600_000;
