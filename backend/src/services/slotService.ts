// This is the "Capacity-Aware Slot Allocation" logic from the spec.
//
// Slots are NOT hard-coded on the frontend. The first time anyone
// asks for a centre's slots on a given date, we generate them here
// from that centre's own configured capacity and operating hours,
// and save them to the database so every farmer sees the same
// live availability from then on.

import { prisma } from "../utils/prismaClient";
import { addMinutes, timeToMinutes } from "../utils/time";

const SLOT_LENGTH_MINUTES = 30;

export async function getOrCreateSlotsForDate(centreId: string, dateStr: string) {
  const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
  if (!centre || !centre.isActive) {
    throw new Error("Procurement centre not found or is not currently active.");
  }

  const date = new Date(`${dateStr}T00:00:00.000Z`);

  const existing = await prisma.slot.findMany({
    where: { centreId, date },
    orderBy: { startTime: "asc" },
  });
  if (existing.length > 0) return existing;

  // Nothing generated for this date yet — build the day's slots now,
  // splitting the centre's daily capacity evenly across every
  // 30-minute window between its operating hours.
  const startMin = timeToMinutes(centre.operatingStart);
  const endMin = timeToMinutes(centre.operatingEnd);
  const slotCount = Math.max(1, Math.floor((endMin - startMin) / SLOT_LENGTH_MINUTES));
  const capacityPerSlot = Math.max(1, Math.floor(centre.dailyCapacity / slotCount));

  const slotsToCreate = [];
  let cursor = centre.operatingStart;
  for (let i = 0; i < slotCount; i++) {
    const start = cursor;
    const end = addMinutes(start, SLOT_LENGTH_MINUTES);
    slotsToCreate.push({
      centreId,
      date,
      startTime: start,
      endTime: end,
      capacity: capacityPerSlot,
      bookedCount: 0,
    });
    cursor = end;
  }

  await prisma.slot.createMany({ data: slotsToCreate });

  return prisma.slot.findMany({ where: { centreId, date }, orderBy: { startTime: "asc" } });
}
