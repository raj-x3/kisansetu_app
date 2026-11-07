// Weight-based, crop-wise slot capacity.
//
// One SlotCapacity row = one crop in one slot. Every capacity change goes
// through the three raw-SQL functions below (reserve / adjust / release).
// Each is a SINGLE UPDATE statement that checks the limit inside its WHERE
// clause, so Postgres locks the row and two farmers booking at the same
// moment cannot both take the last kilograms. The database also carries a
// CHECK constraint as a second guard (utils/capacityConstraints.ts).

import { Prisma, Crop } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { getOrCreateSlotsForDate } from "./slotService";
import { rankSlots, CapacityInput, SlotView } from "../utils/slotRecommend";
import {
  ABSOLUTE_MAX_WEIGHT_KG,
  ALTERNATIVE_DATE_LOOKAHEAD_DAYS,
  ALTERNATIVE_DATE_RESULTS,
} from "../config/capacity";

type Db = Prisma.TransactionClient;

// An error with a machine-readable code, so the frontend can react
// (for example refresh the slot list when a slot became full).
export class CapacityError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

// ---------- Weight validation ----------

export function checkWeight(kg: unknown, crop: Pick<Crop, "maxBookingKg" | "name">): CapacityError | null {
  if (typeof kg !== "number" || !Number.isFinite(kg)) {
    return new CapacityError("WEIGHT_INVALID", "Enter your estimated weight in kilograms.", 400);
  }
  if (kg <= 0) return new CapacityError("WEIGHT_INVALID", "Weight must be greater than zero.", 400);
  if (!Number.isInteger(kg)) {
    return new CapacityError("WEIGHT_INVALID", "Enter a whole number of kilograms (for example 2500).", 400);
  }
  if (kg > ABSOLUTE_MAX_WEIGHT_KG || kg > crop.maxBookingKg) {
    return new CapacityError(
      "WEIGHT_TOO_HIGH",
      `The largest single booking for ${crop.name} is ${Math.min(crop.maxBookingKg, ABSOLUTE_MAX_WEIGHT_KG)} kg. Please enter a smaller weight.`,
      400
    );
  }
  return null;
}

// ---------- Capacity rows ----------

// Makes sure every slot has a capacity row for this crop. New rows start
// from the centre's saved default for that start time, or the crop's own
// default. Safe to call repeatedly and from concurrent requests.
export async function ensureCapacityRows(
  db: Db,
  slots: { id: string; centreId: string; startTime: string }[],
  crop: Pick<Crop, "id" | "defaultSlotCapacityKg">
): Promise<void> {
  if (slots.length === 0) return;
  const templates = await db.capacityTemplate.findMany({
    where: { cropId: crop.id, centreId: { in: [...new Set(slots.map((s) => s.centreId))] } },
  });
  const byKey = new Map(templates.map((t) => [`${t.centreId}|${t.startTime}`, t.maxWeightKg]));
  await db.slotCapacity.createMany({
    data: slots.map((s) => ({
      slotId: s.id,
      cropId: crop.id,
      maxWeightKg: byKey.get(`${s.centreId}|${s.startTime}`) ?? crop.defaultSlotCapacityKg,
    })),
    skipDuplicates: true,
  });
}

// ---------- Atomic reserve / adjust / release ----------

// Takes `kg` of the crop's capacity in a slot, only if it still fits.
// Returns false (nothing changed) when it does not.
export async function reserveWeight(db: Db, slotId: string, cropId: string, kg: number): Promise<boolean> {
  const changed = await db.$executeRaw`
    UPDATE slot_capacities
    SET booked_weight_kg = booked_weight_kg + ${kg},
        booked_count = booked_count + 1,
        updated_at = now()
    WHERE slot_id = ${slotId} AND crop_id = ${cropId}
      AND booked_weight_kg + ${kg} <= max_weight_kg`;
  return changed === 1;
}

// Changes an existing reservation by `deltaKg` (positive = needs more room).
export async function adjustWeight(db: Db, slotId: string, cropId: string, deltaKg: number): Promise<boolean> {
  if (deltaKg === 0) return true;
  const changed = await db.$executeRaw`
    UPDATE slot_capacities
    SET booked_weight_kg = booked_weight_kg + ${deltaKg}, updated_at = now()
    WHERE slot_id = ${slotId} AND crop_id = ${cropId}
      AND booked_weight_kg + ${deltaKg} <= max_weight_kg
      AND booked_weight_kg + ${deltaKg} >= 0`;
  return changed === 1;
}

export async function releaseRaw(db: Db, slotId: string, cropId: string, kg: number): Promise<void> {
  await db.$executeRaw`
    UPDATE slot_capacities
    SET booked_weight_kg = GREATEST(booked_weight_kg - ${kg}, 0),
        booked_count = GREATEST(booked_count - 1, 0),
        updated_at = now()
    WHERE slot_id = ${slotId} AND crop_id = ${cropId}`;
}

// Gives a booking's weight back (cancel, no-show, move). The flag flip is
// a guarded update, so even if this runs twice the weight is released once.
export async function releaseBookingCapacity(db: Db, bookingId: string): Promise<void> {
  const flipped = await db.booking.updateMany({
    where: { id: bookingId, capacityCounted: true },
    data: { capacityCounted: false },
  });
  if (flipped.count === 0) return; // nothing counted (older booking) or already released
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    select: { slotId: true, cropId: true, quantityKg: true },
  });
  if (!b || !b.cropId) return;
  await releaseRaw(db, b.slotId, b.cropId, Math.round(b.quantityKg));
}

// ---------- Reading availability ----------

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// All slots of a centre on a date, with this crop's live capacity.
export async function getCropSlotInputs(centreId: string, crop: Crop, dateStr: string): Promise<CapacityInput[]> {
  const slots = await getOrCreateSlotsForDate(centreId, dateStr);
  await ensureCapacityRows(prisma, slots, crop);
  const caps = await prisma.slotCapacity.findMany({
    where: { cropId: crop.id, slotId: { in: slots.map((s) => s.id) } },
  });
  const capBySlot = new Map(caps.map((c) => [c.slotId, c]));
  const inputs: CapacityInput[] = [];
  for (const s of slots) {
    const cap = capBySlot.get(s.id);
    if (!cap) continue;
    inputs.push({
      slotId: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      maxWeightKg: cap.maxWeightKg,
      bookedWeightKg: cap.bookedWeightKg,
      confirmedFarmers: cap.bookedCount,
      farmerCapReached: s.bookedCount >= s.capacity,
    });
  }
  return inputs;
}

export interface AlternativeDate {
  date: string;
  slot: SlotView; // the best-fit slot on that date
}

export interface Recommendation {
  centreId: string;
  cropId: string;
  date: string;
  weightKg: number | null;
  slots: SlotView[]; // ranked: recommended first, then other suitable, then not suitable
  recommendedSlotId: string | null;
  alternativeDates: AlternativeDate[]; // only filled when nothing fits on `date`
  generatedAt: string;
}

export async function recommendSlots(
  centreId: string,
  crop: Crop,
  dateStr: string,
  weightKg: number | null
): Promise<Recommendation> {
  const inputs = await getCropSlotInputs(centreId, crop, dateStr);
  const slots = rankSlots(inputs, weightKg);
  const recommended = slots.find((s) => s.rank === "RECOMMENDED") ?? null;

  const alternativeDates: AlternativeDate[] = [];
  if (weightKg !== null && !recommended) {
    for (let i = 1; i <= ALTERNATIVE_DATE_LOOKAHEAD_DAYS && alternativeDates.length < ALTERNATIVE_DATE_RESULTS; i++) {
      const d = addDays(dateStr, i);
      if (d < todayStr()) continue;
      const ranked = rankSlots(await getCropSlotInputs(centreId, crop, d), weightKg);
      const best = ranked.find((s) => s.rank === "RECOMMENDED");
      if (best) alternativeDates.push({ date: d, slot: best });
    }
  }

  return {
    centreId,
    cropId: crop.id,
    date: dateStr,
    weightKg,
    slots,
    recommendedSlotId: recommended?.slotId ?? null,
    alternativeDates,
    generatedAt: new Date().toISOString(),
  };
}
