// This is where the actual reservation happens. Order of checks
// matters, and the reservation itself runs inside a single database
// transaction so two farmers can never be double-booked into the
// last spot in a slot at the same moment.

import { nextCaseId } from "../utils/caseId";
import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { sendSms } from "../services/smsService";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";
import { formatBillReference } from "../utils/billReference";

const bookingSchema = z.object({
  slotId: z.string().uuid("A valid slot must be selected."),
  crop: z.string().min(2, "Crop is required."),
  quantityKg: z.number().positive("Expected quantity must be greater than zero."),
});

export async function createBooking(req: Request, res: Response) {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { slotId, crop, quantityKg } = parsed.data;
  const userId = req.user!.userId;

  const farmer = await prisma.farmer.findUnique({ where: { userId }, include: { user: true } });
  if (!farmer) return res.status(404).json({ error: "Farmer profile not found." });

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // 1. Load the slot fresh, inside the transaction, so our
      //    capacity check below is based on the latest true count.
      const slot = await tx.slot.findUnique({ where: { id: slotId } });
      if (!slot) throw new Error("This slot no longer exists.");

      // 2. Prevent duplicate booking: a farmer can only hold one
      //    active booking on a given date, across any centre.
      const existingSameDay = await tx.booking.findFirst({
        where: {
          farmerId: farmer.id,
          status: "BOOKED",
          slot: { date: slot.date },
        },
      });
      if (existingSameDay) {
        throw new Error("You already have an active booking for this date. Cancel it first to book another.");
      }

      // 3. Verify slot availability — the core capacity-aware check.
      if (slot.bookedCount >= slot.capacity) {
        throw new Error("This slot just became full. Please choose a different time.");
      }

      // 4. Reserve the slot.
      await tx.slot.update({
        where: { id: slot.id },
        data: { bookedCount: { increment: 1 } },
      });

      // 5. Generate a token number: sequential per centre, per day.
      // Counts every booking made today regardless of how it later
      // resolved (including COMPLETED) — token numbers must stay
      // permanently unique for the day, or a later booking could be
      // issued a token that collides with an earlier, now-finished one.
      const bookingsTodayAtCentre = await tx.booking.count({
        where: {
          status: { not: "CANCELLED" },
          slot: { centreId: slot.centreId, date: slot.date },
        },
      });
      const tokenNumber = bookingsTodayAtCentre + 1;

      // 6. Store the booking (with its formal Case ID) and start its queue entry.
      const caseId = await nextCaseId(tx, slot.date.getUTCFullYear());
      const newBooking = await tx.booking.create({
        data: {
          farmerId: farmer.id,
          slotId: slot.id,
          caseId,
          tokenNumber,
          crop,
          quantityKg,
          status: "BOOKED",
        },
      });

      await tx.queueEntry.create({
        data: { bookingId: newBooking.id, stage: "SLOT_BOOKED" },
      });

      return { newBooking, slot };
    });

    const centre = await prisma.procurementCentre.findUnique({
      where: { id: booking.slot.centreId },
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "BOOKING_CREATE", {
      bookingId: booking.newBooking.id,
      details: { token: booking.newBooking.tokenNumber, name: centre?.name ?? "" },
    });
    await notifyFarmer(
      farmer.id,
      "bookingConfirmed",
      `Booking confirmed. Token ${booking.newBooking.tokenNumber} at ${centre?.name}.`,
      { token: booking.newBooking.tokenNumber, centre: centre?.name ?? "" }
    );

    // Real SMS to the farmer's registered number — never blocks the
    // response if sending fails.
    sendSms(
      farmer.user.mobile,
      `Booking confirmed at ${centre?.name} on ${new Date(booking.slot.date).toLocaleDateString()} ` +
        `${booking.slot.startTime}-${booking.slot.endTime}. Your token: ${booking.newBooking.tokenNumber}.`
    );

    return res.status(201).json({
      message: "Booking confirmed.",
      booking: {
        id: booking.newBooking.id,
        caseId: booking.newBooking.caseId,
        tokenNumber: booking.newBooking.tokenNumber,
        crop: booking.newBooking.crop,
        quantityKg: booking.newBooking.quantityKg,
        date: booking.slot.date,
        startTime: booking.slot.startTime,
        endTime: booking.slot.endTime,
        centreName: centre?.name,
      },
    });
  } catch (err) {
    // Anything thrown inside the transaction (full slot, duplicate
    // booking, etc.) lands here as a clear, user-facing message —
    // never a raw stack trace.
    return res.status(409).json({ error: err instanceof Error ? err.message : "Booking failed." });
  }
}

export async function getMyBookings(req: Request, res: Response) {
  const userId = req.user!.userId;
  const farmer = await prisma.farmer.findUnique({ where: { userId } });
  if (!farmer) return res.status(404).json({ error: "Farmer profile not found." });

  const bookings = await prisma.booking.findMany({
    where: { farmerId: farmer.id },
    include: {
      slot: { include: { centre: true } },
      queueEntry: true,
      procurement: { include: { qualityCheck: true, weighment: true, payment: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    bookings.map((b) => ({
      id: b.id,
      caseId: b.caseId,
      tokenNumber: b.tokenNumber,
      crop: b.crop,
      quantityKg: b.quantityKg,
      status: b.status,
      stage: b.queueEntry?.stage ?? "SLOT_BOOKED",
      centreId: b.slot.centreId,
      date: b.slot.date,
      startTime: b.slot.startTime,
      endTime: b.slot.endTime,
      centreName: b.slot.centre.name,
      qualityResult: b.procurement?.qualityCheck?.result ?? null,
      netWeightKg: b.procurement?.weighment?.netWeightKg ?? null,
      totalAmount: b.procurement?.totalAmount ?? null,
      billReference:
        b.procurement?.status === "COMPLETED"
          ? formatBillReference(b.procurement.id, b.procurement.createdAt)
          : null,
      paymentStatus: b.procurement?.payment?.status ?? null,
    }))
  );
}
