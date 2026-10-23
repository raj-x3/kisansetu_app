// The QueueEntry.stage field (SLOT_BOOKED → ARRIVED → VERIFIED → …) is
// the lightweight, farmer-facing progress tracker we've used since
// Module 4 — it's what powers the live process-chain visual.
//
// Starting with Quality Check, we also need somewhere to store real
// procurement details: quality results, weight, price, final amount.
// That's the Procurement record. This helper finds a booking's
// Procurement row, or creates one the first time it's needed — so
// quality check, weighing, and completion (built in later modules) can
// all share the same one record instead of each reinventing it.

import { prisma } from "../utils/prismaClient";

export async function getOrCreateProcurement(bookingId: string) {
  const existing = await prisma.procurement.findUnique({ where: { bookingId } });
  if (existing) return existing;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true },
  });
  if (!booking) throw new Error("Booking not found.");

  return prisma.procurement.create({
    data: {
      bookingId: booking.id,
      farmerId: booking.farmerId,
      centreId: booking.slot.centreId,
      crop: booking.crop,
      status: "VERIFIED",
    },
  });
}
