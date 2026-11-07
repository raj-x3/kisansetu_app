// Waiting-time maths, kept free of the database so it can be read and
// tested on its own.
//
//   Estimated wait = remaining work of the farmers ahead / working counters
//
// "Work" is measured in minutes, using the centre's measured average
// processing time (or a clearly labelled baseline when there is not enough
// history yet). Farmers already part-way through count only for the steps
// they still have to do.

export type Stage = "SLOT_BOOKED" | "ARRIVED" | "VERIFIED" | "QUALITY_CHECKED" | "WEIGHED" | "COMPLETED";

// Share of one farmer's processing still to do when they are at this stage.
// Four steps of equal size are assumed: verify, quality, weigh, complete.
export const STAGE_REMAINING: Record<Stage, number> = {
  SLOT_BOOKED: 1,
  ARRIVED: 1,
  VERIFIED: 0.75,
  QUALITY_CHECKED: 0.5,
  WEIGHED: 0.25,
  COMPLETED: 0,
};

export type Basis = "MEASURED" | "BASELINE";

export interface ServiceTime {
  minutes: number;
  basis: Basis;
  samples: number;
}

// Rolling average of real processing times. `samples` are minutes per finished
// farmer. Samples outside [minMin, maxMin] are ignored. When there are too
// few real samples the centre's baseline is used and labelled as such.
export function rollingServiceTime(
  samples: number[],
  baselineMin: number,
  cfg: { minSamples: number; sampleMinMinutes: number; sampleMaxMinutes: number }
): ServiceTime {
  const good = samples.filter((s) => Number.isFinite(s) && s >= cfg.sampleMinMinutes && s <= cfg.sampleMaxMinutes);
  if (good.length < cfg.minSamples) return { minutes: Math.max(1, baselineMin), basis: "BASELINE", samples: good.length };
  const mean = good.reduce((a, b) => a + b, 0) / good.length;
  return { minutes: Math.max(1, Math.round(mean * 10) / 10), basis: "MEASURED", samples: good.length };
}

// A counter needs one staff member AND one machine, so the working number
// is the smaller of the two unless staff set it by hand.
export function effectiveCounters(activeCounters: number | null, numOperators: number, numMachines: number): number {
  const n = activeCounters ?? Math.min(numOperators, numMachines);
  return Math.max(1, Math.floor(n));
}

export interface EstimateInput {
  workloadMin: number; // total remaining work of the farmers ahead, in minutes
  counters: number;
  ownServiceMin: number; // how long this farmer's own processing takes
  delayMin: number; // extra delay reported by an officer
  basis: Basis;
  spreadMeasured: number;
  spreadBaseline: number;
}

export interface Estimate {
  startLowMin: number; // time until processing starts
  startHighMin: number;
  completeLowMin: number; // total time until procurement is complete
  completeHighMin: number;
  workloadMin: number;
  counters: number;
  basis: Basis;
}

const floor5 = (x: number) => Math.max(0, Math.floor(x / 5) * 5);
const ceil5 = (x: number) => Math.max(0, Math.ceil(x / 5) * 5);

export function estimateWait(i: EstimateInput): Estimate {
  const counters = Math.max(1, i.counters);
  const spread = i.basis === "MEASURED" ? i.spreadMeasured : i.spreadBaseline;
  const start = Math.max(0, i.workloadMin / counters + Math.max(0, i.delayMin));
  const startLow = floor5(start * (1 - spread));
  let startHigh = ceil5(start * (1 + spread));
  if (start > 0 && startHigh <= startLow) startHigh = startLow + 5;
  const own = Math.max(1, i.ownServiceMin);
  return {
    startLowMin: startLow,
    startHighMin: startHigh,
    completeLowMin: floor5(start * (1 - spread) + own * (1 - spread)),
    completeHighMin: ceil5(start * (1 + spread) + own * (1 + spread)),
    workloadMin: Math.round(i.workloadMin),
    counters,
    basis: i.basis,
  };
}

export type QueueLevel = "LOW" | "MODERATE" | "HIGH" | "DELAYED" | "PAUSED";

export function classifyCentre(i: {
  paused: boolean;
  delayMin: number;
  newArrivalWaitMin: number; // wait a farmer arriving now would face
  serviceMin: number;
  baselineMin: number;
  basis: Basis;
  cfg: { lowMaxWaitMin: number; moderateMaxWaitMin: number; delayedFactor: number };
}): QueueLevel {
  if (i.paused) return "PAUSED";
  const slow = i.basis === "MEASURED" && i.baselineMin > 0 && i.serviceMin / i.baselineMin >= i.cfg.delayedFactor;
  if (i.delayMin > 0 || slow) return "DELAYED";
  if (i.newArrivalWaitMin <= i.cfg.lowMaxWaitMin) return "LOW";
  if (i.newArrivalWaitMin <= i.cfg.moderateMaxWaitMin) return "MODERATE";
  return "HIGH";
}

// ---------- Look ahead: will the queue build up later today? ----------

export interface ArrivalBucket {
  hour: number; // local hour of the day, 0-23
  expectedArrivals: number; // booked farmers who have not arrived yet, in slots starting this hour
}

export interface HourPrediction {
  hour: number;
  expectedArrivals: number;
  capacityFarmers: number; // how many farmers the counters can finish in this hour
  predictedQueue: number; // farmers still waiting at the end of the hour
  predictedWaitMin: number;
  utilizationPct: number;
  level: "NORMAL" | "MODERATE" | "HIGH";
  delayRisk: boolean; // more farmers arrive than the counters can finish
}

export function predictCongestion(i: {
  startQueue: number; // farmers present and waiting now
  nowHour: number;
  nowMinute: number;
  endHour: number; // closing hour (exclusive)
  buckets: ArrivalBucket[];
  showUpRate: number;
  serviceMin: number;
  counters: number;
  delayMin: number;
  cfg: { lowMaxWaitMin: number; moderateMaxWaitMin: number };
}): HourPrediction[] {
  const out: HourPrediction[] = [];
  let queue = i.startQueue;
  const perHour = (i.counters * 60) / Math.max(1, i.serviceMin);
  for (let h = i.nowHour; h < i.endHour; h++) {
    // Farmers whose slot hour has already passed but who are not here yet are counted in the current hour.
    const arrivals =
      i.buckets.filter((b) => (h === i.nowHour ? b.hour <= h : b.hour === h)).reduce((a, b) => a + b.expectedArrivals, 0) *
      i.showUpRate;
    const fraction = h === i.nowHour ? Math.max(0.1, (60 - i.nowMinute) / 60) : 1;
    const capacity = perHour * fraction;
    const demand = queue + arrivals;
    queue = Math.max(0, demand - capacity);
    const wait = (queue * i.serviceMin) / Math.max(1, i.counters) + (h === i.nowHour ? Math.max(0, i.delayMin) : 0);
    const level = wait <= i.cfg.lowMaxWaitMin ? "NORMAL" : wait <= i.cfg.moderateMaxWaitMin ? "MODERATE" : "HIGH";
    out.push({
      hour: h,
      expectedArrivals: Math.round(arrivals * 10) / 10,
      capacityFarmers: Math.round(capacity * 10) / 10,
      predictedQueue: Math.round(queue * 10) / 10,
      predictedWaitMin: Math.round(wait),
      utilizationPct: capacity > 0 ? Math.round((demand / capacity) * 100) : 100,
      level,
      delayRisk: arrivals > capacity,
    });
  }
  return out;
}
