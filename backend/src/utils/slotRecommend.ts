// The "which slot suits this farmer" logic, kept completely free of the
// database so it is easy to read and to test on its own.
//
// Rules (from the spec):
//   1. Only slots whose remaining capacity is >= the farmer's weight are suitable.
//   2. Among suitable slots, the SMALLEST sufficient remaining capacity wins
//      ("best fit"), because it leaves the least capacity unused. A tie goes
//      to the earlier slot.
//   3. A slot that cannot hold the whole weight is never recommended, and a
//      booking is never silently split across slots.
//
// The backend runs this on live numbers every time. The frontend only
// displays the result.

// A slot is shown as "Limited" when less than this share of its capacity is left.
// A display setting, not an official figure.
export const LIMITED_FRACTION = 0.25;

export type SlotStatus = "AVAILABLE" | "LIMITED" | "FULL";
export type SlotRank = "RECOMMENDED" | "ALTERNATIVE" | "NOT_SUITABLE" | "UNRANKED";
// Language-neutral reason codes. The frontend turns them into sentences.
export type SlotReason = "bestFit" | "alsoFits" | "tooSmall" | "full" | "farmerCap" | "none";

export interface CapacityInput {
  slotId: string;
  startTime: string;
  endTime: string;
  maxWeightKg: number;
  bookedWeightKg: number;
  confirmedFarmers: number;
  farmerCapReached: boolean; // the older "farmers per slot" limit
}

export interface SlotView {
  slotId: string;
  startTime: string;
  endTime: string;
  maxWeightKg: number;
  bookedWeightKg: number;
  remainingKg: number;
  utilizationPct: number;
  confirmedFarmers: number;
  status: SlotStatus;
  rank: SlotRank;
  reason: SlotReason;
  // Capacity left if this farmer books it. Only set for suitable slots.
  afterBookingKg: number | null;
}

export function remainingOf(max: number, booked: number): number {
  return Math.max(0, max - booked);
}

export function slotStatus(max: number, remaining: number, farmerCapReached: boolean): SlotStatus {
  if (remaining <= 0 || farmerCapReached) return "FULL";
  if (max > 0 && remaining / max < LIMITED_FRACTION) return "LIMITED";
  return "AVAILABLE";
}

export function rankSlots(inputs: CapacityInput[], weightKg: number | null): SlotView[] {
  const views: SlotView[] = inputs.map((c) => {
    const remaining = remainingOf(c.maxWeightKg, c.bookedWeightKg);
    const status = slotStatus(c.maxWeightKg, remaining, c.farmerCapReached);
    const utilizationPct = c.maxWeightKg > 0 ? Math.min(100, Math.round((c.bookedWeightKg / c.maxWeightKg) * 100)) : 100;
    return {
      slotId: c.slotId,
      startTime: c.startTime,
      endTime: c.endTime,
      maxWeightKg: c.maxWeightKg,
      bookedWeightKg: c.bookedWeightKg,
      remainingKg: remaining,
      utilizationPct,
      confirmedFarmers: c.confirmedFarmers,
      status,
      rank: "UNRANKED",
      reason: "none",
      afterBookingKg: null,
    };
  });

  // No weight entered yet: show the slots in time order, ranked by nothing.
  if (weightKg === null) {
    return views.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  const suitable: SlotView[] = [];
  const notSuitable: SlotView[] = [];
  for (const v of views) {
    if (v.status === "FULL") {
      v.rank = "NOT_SUITABLE";
      v.reason = v.remainingKg <= 0 ? "full" : "farmerCap";
      notSuitable.push(v);
    } else if (v.remainingKg < weightKg) {
      v.rank = "NOT_SUITABLE";
      v.reason = "tooSmall";
      notSuitable.push(v);
    } else {
      v.rank = "ALTERNATIVE";
      v.reason = "alsoFits";
      v.afterBookingKg = v.remainingKg - weightKg;
      suitable.push(v);
    }
  }

  // Best fit first: smallest sufficient remaining capacity, then earliest time.
  suitable.sort((a, b) => a.remainingKg - b.remainingKg || a.startTime.localeCompare(b.startTime));
  if (suitable.length > 0) {
    suitable[0].rank = "RECOMMENDED";
    suitable[0].reason = "bestFit";
  }
  notSuitable.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return [...suitable, ...notSuitable];
}
