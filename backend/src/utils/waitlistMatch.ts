// "Who should get this room?" kept free of the database so the rules can be
// read and tested alone.
//
// A waitlisted farmer is eligible for a slot only when ALL of these hold:
//   - same centre, same crop (a wheat farmer never sees a paddy slot)
//   - the slot is on the preferred date and inside the preferred time range
//   - the slot has room for the farmer's WHOLE quantity (never split)
//   - the slot has not started, and still has a farmer place free
//   - the farmer has no other active booking or pending offer that day
//   - the farmer was not already offered this same slot
// Eligible farmers are ordered first come, first served (registration time,
// then id). The room is handed out in that order, each offer reducing what
// is left; a farmer who does not fit is skipped and the next one is tried.

export type SkipReason =
  | "notActive"
  | "wrongCentre"
  | "wrongCrop"
  | "wrongDate"
  | "outsideTimeRange"
  | "slotPast"
  | "noFarmerPlace"
  | "alreadyBooked"
  | "hasPendingOffer"
  | "previouslyOffered"
  | "notFullFit"
  | "fits"; // eligible

export interface MatchEntry {
  id: string;
  farmerId: string;
  centreId: string;
  cropId: string;
  quantityKg: number;
  preferredDate: string; // YYYY-MM-DD
  windowStart: string | null;
  windowEnd: string | null;
  createdAtMs: number;
  status: "ACTIVE" | "OFFERED" | "FULFILLED" | "WITHDRAWN" | "EXPIRED";
}

export interface MatchSlot {
  slotId: string;
  centreId: string;
  cropId: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  remainingKg: number;
  placesLeft: number; // farmer places left under the older per-slot limit
  endMs: number;
}

export interface MatchContext {
  nowMs: number;
  bookedDates: Map<string, Set<string>>; // farmerId -> dates with an active booking
  pendingOfferDates: Map<string, Set<string>>; // farmerId -> dates with a pending offer
  offeredBefore: Set<string>; // `${entryId}|${slotId}`
}

export interface Decision {
  entryId: string;
  farmerId: string;
  reason: SkipReason;
  eligible: boolean;
  shortfallKg?: number;
}

export function entryComparator(a: MatchEntry, b: MatchEntry): number {
  return a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id);
}

// Checks everything except "does it fit right now" first, then the fit.
export function evaluateEntry(entry: MatchEntry, slot: MatchSlot, remainingKg: number, placesLeft: number, ctx: MatchContext): Decision {
  const d = (reason: SkipReason, extra: Partial<Decision> = {}): Decision => ({
    entryId: entry.id,
    farmerId: entry.farmerId,
    reason,
    eligible: reason === "fits",
    ...extra,
  });
  if (entry.status !== "ACTIVE") return d("notActive");
  if (entry.centreId !== slot.centreId) return d("wrongCentre");
  if (entry.cropId !== slot.cropId) return d("wrongCrop");
  if (entry.preferredDate !== slot.date) return d("wrongDate");
  if (slot.endMs <= ctx.nowMs) return d("slotPast");
  if (entry.windowStart && slot.startTime < entry.windowStart) return d("outsideTimeRange");
  if (entry.windowEnd && slot.endTime > entry.windowEnd) return d("outsideTimeRange");
  if (ctx.bookedDates.get(entry.farmerId)?.has(slot.date)) return d("alreadyBooked");
  if (ctx.pendingOfferDates.get(entry.farmerId)?.has(slot.date)) return d("hasPendingOffer");
  if (ctx.offeredBefore.has(`${entry.id}|${slot.slotId}`)) return d("previouslyOffered");
  if (placesLeft <= 0) return d("noFarmerPlace");
  if (remainingKg < entry.quantityKg) return d("notFullFit", { shortfallKg: entry.quantityKg - remainingKg });
  return d("fits");
}

export interface Plan {
  offers: { entryId: string; farmerId: string; quantityKg: number }[];
  decisions: Decision[]; // one per entry, in priority order
  remainingAfterKg: number;
}

// Hands out the room in first-come order. The same function is used for the
// real allocation and for the officer's "why was this farmer skipped" view.
export function planOffers(slot: MatchSlot, entries: MatchEntry[], ctx: MatchContext): Plan {
  let remaining = slot.remainingKg;
  let places = slot.placesLeft;
  const decisions: Decision[] = [];
  const offers: Plan["offers"] = [];
  for (const e of [...entries].sort(entryComparator)) {
    const dec = evaluateEntry(e, slot, remaining, places, ctx);
    decisions.push(dec);
    if (dec.eligible) {
      offers.push({ entryId: e.id, farmerId: e.farmerId, quantityKg: e.quantityKg });
      remaining -= e.quantityKg;
      places -= 1;
      // The same farmer cannot be given a second offer for this date in the same pass.
      const set = ctx.pendingOfferDates.get(e.farmerId) ?? new Set<string>();
      set.add(slot.date);
      ctx.pendingOfferDates.set(e.farmerId, set);
    }
  }
  return { offers, decisions, remainingAfterKg: remaining };
}
