// Settings for the live queue, wait-time estimates and the waitlist.
// These are application settings you can tune (via environment variables),
// not official standards. Every number has a default so nothing is required.

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function queueConfig() {
  return {
    // How the average processing time is measured.
    rollingSamples: num("QUEUE_ROLLING_SAMPLES", 30), // last N finished farmers
    rollingDays: num("QUEUE_ROLLING_DAYS", 14),
    minSamples: num("QUEUE_MIN_SAMPLES", 3), // fewer than this: use the centre's baseline
    sampleMinMinutes: 1, // anything shorter is not a real visit (e.g. instant demo clicks)
    sampleMaxMinutes: 240,

    // The estimate is shown as a range. Wider when there is less real data.
    spreadMeasured: 0.2,
    spreadBaseline: 0.35,

    // Share of booked farmers who really come. Used until enough history exists.
    baselineShowUpRate: 0.9,
    minShowUpSamples: 10,

    // How busy a centre looks, judged by the wait a new arrival would face.
    lowMaxWaitMin: num("QUEUE_LOW_MAX_WAIT_MIN", 20),
    moderateMaxWaitMin: num("QUEUE_MODERATE_MAX_WAIT_MIN", 45),
    // "Delayed" when measured processing is this many times slower than the centre's baseline.
    delayedFactor: 1.5,

    // Farmer notifications: only for real changes, and not too often.
    notifyMinChangeMin: num("QUEUE_NOTIFY_MIN_CHANGE_MIN", 15),
    notifyMinChangePct: 0.25,
    notifyCooldownMin: num("QUEUE_NOTIFY_COOLDOWN_MIN", 20),

    // Waitlist.
    defaultOfferWindowMin: 15,
    minOfferWindowMin: 2,
    maxOfferWindowMin: 240,
    maxActiveWaitlistEntries: 5,
    maxMissedOffers: 3, // an entry that lets this many offers expire is removed
    waitlistLookaheadDays: 14,

    // Background job (offer expiry and queue notifications).
    jobTickSeconds: num("JOB_TICK_SECONDS", 30),
  };
}

export type QueueConfig = ReturnType<typeof queueConfig>;
