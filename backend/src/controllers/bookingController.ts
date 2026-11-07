// This is where the actual reservation happens. Order of checks
// matters, and the reservation itself runs inside a single database
// transaction so two farmers can never be double-booked into the
// last spot in a slot at the same moment.

import { nextCaseId } from "../utils/caseId";
import { nextTokenNumber } from "../utils/tokenNumber";
import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { sendSms } from "../services/smsService";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";
import { formatBillReference } from "../utils/billReference";
import { getIO } from "../socket";
import {
  CapacityError,
  checkWeight,
  ensureCapacityRows,
  reserveWeight,
  adjustWeight,
  releaseBookingCapacity,
} from "../services/capacityService";
import { hasOpenEmergency, OPEN_EMERGENCY_MESSAGE } from "../services/emergencyService";
import { onCapacityReleased } from "../services/waitlistService";

// Tells officers' screens to refresh their capacity numbers. A bonus: never blocks a booking.
function emitCapacityChanged(centreId: string) {
  try {
    getIO().to(`centre:${centreId}`).emit("capacity-updated", { centreId });
  } catch {
    /* live update is a bonus */
  }
}

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const bookingSchema = z.object({
  slotId: z.string().uuid("A valid slot must be selected."),
  cropId: z.string().uuid("Please choose a crop.").optional(),
  crop: z.string().min(2, "Crop is required.").optional(), // older clients send the name
  quantityKg: z.number({ invalid_type_error: "Enter your estimated weight in kilograms." }),
});

export async function createBooking(req: Request, res: Response) {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { slotId, quantityKg } = parsed.data;
  const userId = req.user!.userId;

  const farmer = await prisma.farmer.findUnique({ where: { userId }, include: { user: true } });
  if (!farmer) return res.status(404).json({ error: "Farmer profile not found." });

  // Which crop? By id, or (older clients) by name. The crop decides which
  // capacity is used, so it must be a real, active crop.
  const crop = parsed.data.cropId
    ? await prisma.crop.findUnique({ where: { id: parsed.data.cropId } })
    : parsed.data.crop
    ? await prisma.crop.findFirst({ where: { name: { equals: parsed.data.crop, mode: "insensitive" } } })
    : null;
  if (!crop || !crop.isActive) {
    return res.status(400).json({ error: "Please choose a crop that is available for booking.", code: "CROP_INVALID" });
  }
  const weightProblem = checkWeight(quantityKg, crop);
  if (weightProblem) return res.status(weightProblem.status).json({ error: weightProblem.message, code: weightProblem.code });

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // 0. Lock this farmer's row for the rest of the transaction. If the
      //    same farmer double-clicks, or sends two requests at once, the
      //    second waits here and then sees the first booking, so it is
      //    rejected as a duplicate instead of both slipping through.
      await tx.$queryRaw`SELECT id FROM farmers WHERE id = ${farmer.id} FOR UPDATE`;

      // 1. Load the slot fresh, inside the transaction, so our
      //    capacity check below is based on the latest true count.
      const slot = await tx.slot.findUnique({ where: { id: slotId } });
      if (!slot) throw new CapacityError("SLOT_GONE", "This slot no longer exists.");
      if (slot.date < todayUtc()) throw new CapacityError("DATE_PAST", "You can't book a slot on a past date.");

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
        throw new CapacityError(
          "DUPLICATE_BOOKING",
          "You already have an active booking for this date. Cancel it first to book another."
        );
      }

      // 3. Reserve the farmer place (the older per-slot farmer limit). One
      //    guarded update: it only succeeds while there is still a place.
      const place = await tx.slot.updateMany({
        where: { id: slot.id, bookedCount: { lt: slot.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (place.count === 0) {
        throw new CapacityError("SLOT_FULL", "This slot just became full. Please choose a different time.");
      }

      // 4. Reserve the WEIGHT in this crop's own capacity. One atomic SQL
      //    update that checks the limit itself (see capacityService.ts), so
      //    two farmers can never both take the last kilograms.
      await ensureCapacityRows(tx, [slot], crop);
      const reserved = await reserveWeight(tx, slot.id, crop.id, quantityKg);
      if (!reserved) {
        throw new CapacityError(
          "SLOT_FULL",
          `This slot no longer has ${quantityKg} kg of ${crop.name} capacity left. Please choose another slot.`
        );
      }

      // 5. Generate a token number: sequential per centre, per day, and
      // never reused (see utils/tokenNumber.ts).
      const tokenNumber = await nextTokenNumber(tx, slot.centreId, slot.date);

      // 6. Store the booking (with its formal Case ID) and start its queue entry.
      const caseId = await nextCaseId(tx, slot.date.getUTCFullYear());
      const newBooking = await tx.booking.create({
        data: {
          farmerId: farmer.id,
          slotId: slot.id,
          caseId,
          tokenNumber,
          crop: crop.name,
          cropId: crop.id,
          quantityKg,
          capacityCounted: true,
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

    emitCapacityChanged(booking.slot.centreId);
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
    // never a raw stack trace. `code` lets the screen react (for
    // example, refresh the slot list when a slot became full).
    if (err instanceof CapacityError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error("createBooking failed:", err);
    return res.status(409).json({ error: "Booking could not be completed. Please try again.", code: "BOOKING_FAILED" });
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
      cropId: b.cropId,
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

// ---------- Cancel and reschedule ----------
// A farmer can cancel or move a booking only while it is still at
// "Slot booked" — once the gate officer has marked them arrived, the
// case is in progress and only the centre staff can act on it.

async function loadOwnActiveBooking(userId: string, bookingId: string) {
  const farmer = await prisma.farmer.findUnique({ where: { userId }, include: { user: true } });
  if (!farmer) return { error: { code: 404, message: "Farmer profile not found." } } as const;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: { include: { centre: true } }, queueEntry: true },
  });
  if (!booking || booking.farmerId !== farmer.id) return { error: { code: 404, message: "Booking not found." } } as const;
  if (booking.status !== "BOOKED") {
    return { error: { code: 409, message: "This booking is no longer active." } } as const;
  }
  if ((booking.queueEntry?.stage ?? "SLOT_BOOKED") !== "SLOT_BOOKED") {
    return {
      error: { code: 409, message: "You have already arrived at the centre, so this booking can no longer be changed." },
    } as const;
  }
  // While an emergency request is open the booking must stay as it is.
  if (await hasOpenEmergency(prisma, booking.id)) {
    return { error: { code: 409, message: OPEN_EMERGENCY_MESSAGE } } as const;
  }
  return { farmer, booking } as const;
}

export async function cancelBooking(req: Request, res: Response) {
  try {
    const found = await loadOwnActiveBooking(req.user!.userId, req.params.id);
    if ("error" in found) return res.status(found.error.code).json({ error: found.error.message });
    const { farmer, booking } = found;

    await prisma.$transaction(async (tx) => {
      // Guarded updates: if the officer marked the farmer arrived a moment ago,
      // nothing changes and we report it instead of cancelling a case in progress.
      const stage = await tx.queueEntry.findUnique({ where: { bookingId: booking.id }, select: { stage: true } });
      if (stage && stage.stage !== "SLOT_BOOKED") throw new Error("You have already arrived at the centre.");
      const changed = await tx.booking.updateMany({
        where: { id: booking.id, status: "BOOKED" },
        data: { status: "CANCELLED" },
      });
      if (changed.count === 0) throw new Error("This booking is no longer active.");
      await tx.slot.updateMany({
        where: { id: booking.slotId, bookedCount: { gt: 0 } },
        data: { bookedCount: { decrement: 1 } },
      });
      // Give the reserved weight back to this crop's capacity.
      await releaseBookingCapacity(tx, booking.id);
    });
    emitCapacityChanged(booking.slot.centreId);
    // The freed room goes to the waitlist (never blocks or fails the cancellation).
    await onCapacityReleased({ slotId: booking.slotId, cropId: booking.cropId, kg: Math.round(booking.quantityKg), trigger: "CANCELLATION" });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "BOOKING_CANCEL", {
      bookingId: booking.id,
      details: { token: booking.tokenNumber },
    });
    await notifyFarmer(
      farmer.id,
      "bookingCancelled",
      `Your booking (token ${booking.tokenNumber}) was cancelled.`,
      { token: booking.tokenNumber }
    );
    sendSms(farmer.user.mobile, `Your booking at ${booking.slot.centre.name} (token ${booking.tokenNumber}) was cancelled.`);
    try {
      getIO().to(`centre:${booking.slot.centreId}`).emit("stage-updated", {
        centreId: booking.slot.centreId,
        bookingId: booking.id,
        stage: "SLOT_BOOKED",
        status: "CANCELLED",
      });
    } catch {
      /* live update is a bonus — never block the cancel */
    }
    return res.json({ message: "Booking cancelled." });
  } catch (err) {
    return res.status(409).json({ error: err instanceof Error ? err.message : "Could not cancel the booking." });
  }
}

const rescheduleSchema = z.object({ slotId: z.string().uuid("Please choose a new slot.") });

export async function rescheduleBooking(req: Request, res: Response) {
  try {
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const found = await loadOwnActiveBooking(req.user!.userId, req.params.id);
    if ("error" in found) return res.status(found.error.code).json({ error: found.error.message });
    const { farmer, booking } = found;

    const result = await prisma.$transaction(async (tx) => {
      const newSlot = await tx.slot.findUnique({ where: { id: parsed.data.slotId } });
      if (!newSlot) throw new Error("This slot no longer exists.");
      if (newSlot.id === booking.slotId) throw new Error("This is already your slot. Please choose a different one.");
      // Same centre only: moving centres would also change the queue you are in.
      if (newSlot.centreId !== booking.slot.centreId) {
        throw new Error("You can only move to another time at the same centre. To change centre, cancel and book again.");
      }
      if (newSlot.date < todayUtc()) throw new Error("You can't move a booking to a past date.");
      if (newSlot.bookedCount >= newSlot.capacity) throw new Error("This slot is full. Please choose a different time.");

      const sameDay = await tx.booking.findFirst({
        where: { farmerId: farmer.id, status: "BOOKED", id: { not: booking.id }, slot: { date: newSlot.date } },
      });
      if (sameDay) throw new Error("You already have another active booking on that date.");

      // Take the new place first, then free the old one. For weight, the same
      // crop and the same kilograms are reserved in the new slot first; if they
      // do not fit there, nothing has changed and the farmer keeps the old slot.
      if (booking.capacityCounted && booking.cropId) {
        const crop = await tx.crop.findUnique({ where: { id: booking.cropId } });
        if (crop) await ensureCapacityRows(tx, [newSlot], crop);
        const fits = await reserveWeight(tx, newSlot.id, booking.cropId, Math.round(booking.quantityKg));
        if (!fits) {
          throw new CapacityError("SLOT_FULL", `That slot doesn't have enough ${booking.crop} capacity for ${booking.quantityKg} kg. Please choose another.`);
        }
      }
      const taken = await tx.slot.updateMany({
        where: { id: newSlot.id, bookedCount: { lt: newSlot.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (taken.count === 0) throw new Error("This slot just became full. Please choose a different time.");
      await tx.slot.updateMany({
        where: { id: booking.slotId, bookedCount: { gt: 0 } },
        data: { bookedCount: { decrement: 1 } },
      });
      if (booking.capacityCounted && booking.cropId) {
        // Free the old slot's weight (the booking row still points at the old slot until the update below).
        await tx.$executeRaw`
          UPDATE slot_capacities
          SET booked_weight_kg = GREATEST(booked_weight_kg - ${Math.round(booking.quantityKg)}, 0),
              booked_count = GREATEST(booked_count - 1, 0), updated_at = now()
          WHERE slot_id = ${booking.slotId} AND crop_id = ${booking.cropId}`;
      }

      // Token numbers belong to a centre and a day: same day keeps the
      // token, a different day gets the next free token for that day.
      const sameDate = newSlot.date.getTime() === booking.slot.date.getTime();
      const tokenNumber = sameDate ? booking.tokenNumber : await nextTokenNumber(tx, newSlot.centreId, newSlot.date);

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { slotId: newSlot.id, tokenNumber },
      });
      return { updated, newSlot };
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "BOOKING_RESCHEDULE", {
      bookingId: booking.id,
      details: { token: result.updated.tokenNumber },
    });
    const when = `${new Date(result.newSlot.date).toLocaleDateString("en-IN")} ${result.newSlot.startTime}-${result.newSlot.endTime}`;
    await notifyFarmer(
      farmer.id,
      "bookingRescheduled",
      `Your booking was moved to ${when}. Token ${result.updated.tokenNumber}.`,
      { token: result.updated.tokenNumber, when }
    );
    sendSms(
      farmer.user.mobile,
      `Your booking at ${booking.slot.centre.name} was moved to ${when}. Your token: ${result.updated.tokenNumber}.`
    );
    try {
      getIO().to(`centre:${booking.slot.centreId}`).emit("stage-updated", {
        centreId: booking.slot.centreId,
        bookingId: booking.id,
        stage: "SLOT_BOOKED",
        status: "BOOKED",
      });
    } catch {
      /* live update is a bonus */
    }
    emitCapacityChanged(booking.slot.centreId);
    await onCapacityReleased({ slotId: booking.slotId, cropId: booking.cropId, kg: Math.round(booking.quantityKg), trigger: "RESCHEDULE" });
    return res.json({
      message: "Booking moved.",
      booking: {
        id: booking.id,
        caseId: booking.caseId,
        tokenNumber: result.updated.tokenNumber,
        date: result.newSlot.date,
        startTime: result.newSlot.startTime,
        endTime: result.newSlot.endTime,
      },
    });
  } catch (err) {
    if (err instanceof CapacityError) return res.status(err.status).json({ error: err.message, code: err.code });
    return res.status(409).json({ error: err instanceof Error ? err.message : "Could not move the booking." });
  }
}

// ---------- Change the estimated weight ----------
// Allowed only while the booking is still at "Slot booked". More weight is
// accepted only if the same slot still has that room for the same crop;
// less weight frees the difference straight away.

const weightSchema = z.object({
  quantityKg: z.number({ invalid_type_error: "Enter your estimated weight in kilograms." }),
});

export async function changeBookingWeight(req: Request, res: Response) {
  try {
    const parsed = weightSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const found = await loadOwnActiveBooking(req.user!.userId, req.params.id);
    if ("error" in found) return res.status(found.error.code).json({ error: found.error.message });
    const { booking } = found;

    const newKg = parsed.data.quantityKg;
    const crop = booking.cropId ? await prisma.crop.findUnique({ where: { id: booking.cropId } }) : null;
    const problem = checkWeight(newKg, crop ?? { name: booking.crop, maxBookingKg: 1_000_000 });
    if (problem) return res.status(problem.status).json({ error: problem.message, code: problem.code });

    const oldKg = Math.round(booking.quantityKg);
    if (newKg === oldKg) return res.status(400).json({ error: "That is already your booked weight." });

    await prisma.$transaction(async (tx) => {
      const stage = await tx.queueEntry.findUnique({ where: { bookingId: booking.id }, select: { stage: true } });
      if (stage && stage.stage !== "SLOT_BOOKED") throw new CapacityError("TOO_LATE", "You have already arrived at the centre.");
      const live = await tx.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
      if (!live || live.status !== "BOOKED") throw new CapacityError("NOT_ACTIVE", "This booking is no longer active.");
      if (booking.capacityCounted && booking.cropId) {
        const ok = await adjustWeight(tx, booking.slotId, booking.cropId, newKg - oldKg);
        if (!ok) {
          throw new CapacityError(
            "SLOT_FULL",
            `This slot can't take ${newKg} kg of ${booking.crop}. You can keep ${oldKg} kg, or move to another slot.`
          );
        }
      }
      await tx.booking.update({ where: { id: booking.id }, data: { quantityKg: newKg } });
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "BOOKING_WEIGHT_CHANGE", {
      bookingId: booking.id,
      details: { token: booking.tokenNumber, kg: newKg },
    });
    emitCapacityChanged(booking.slot.centreId);
    if (newKg < oldKg) {
      await onCapacityReleased({ slotId: booking.slotId, cropId: booking.cropId, kg: oldKg - newKg, trigger: "WEIGHT_REDUCED" });
    }
    return res.json({ message: "Weight updated.", quantityKg: newKg });
  } catch (err) {
    if (err instanceof CapacityError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error("changeBookingWeight failed:", err);
    return res.status(500).json({ error: "Could not change the weight. Please try again." });
  }
}
