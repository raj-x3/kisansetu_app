// Everything here is scoped to the logged-in operator's OWN centre —
// an operator at Karnal can never see or act on Panipat's queue. That
// scoping happens by looking up the operator's centreId first, on
// every single function, rather than trusting anything from the client.

import { releaseBookingCapacity } from "../services/capacityService";
import { hasOpenEmergency } from "../services/emergencyService";
import { documentsRuleError } from "../services/documentService";
import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { getOrCreateProcurement } from "../services/procurementService";
import { getPricePerKg } from "../config/prices";
import { formatBillReference } from "../utils/billReference";
import { sendSms } from "../services/smsService";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";
import { onCapacityReleased } from "../services/waitlistService";
import { recordStageChange } from "../services/queueService";

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function getOperatorCentreId(userId: string): Promise<string | null> {
  const operator = await prisma.operator.findUnique({ where: { userId } });
  return operator?.centreId ?? null;
}

// The full queue table for today, at this operator's centre — token,
// farmer name, crop, quantity, and current stage for every booking.
export async function getTodayQueue(req: Request, res: Response) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  // Includes COMPLETED bookings on purpose — the table below already
  // knows how to render a completed row (bill reference, payment
  // status, "—" for action), and an operator should still see the
  // whole day's queue after finishing some of it, not have people
  // disappear the moment they're done.
  const bookings = await prisma.booking.findMany({
    where: { status: { notIn: ["CANCELLED", "NO_SHOW"] }, slot: { centreId, date: startOfToday() } },
    include: {
      farmer: true,
      queueEntry: true,
      procurement: { include: { qualityCheck: true, weighment: true, payment: true } },
    },
    orderBy: { tokenNumber: "asc" },
  });

  const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });

  const rows = bookings.map((b) => ({
    bookingId: b.id,
    caseId: b.caseId,
    tokenNumber: b.tokenNumber,
    farmerName: b.farmer.fullName,
    farmerCode: b.farmer.farmerCode,
    crop: b.crop,
    quantityKg: b.quantityKg,
    stage: b.queueEntry?.stage ?? "SLOT_BOOKED",
    qualityResult: b.procurement?.qualityCheck?.result ?? null,
    netWeightKg: b.procurement?.weighment?.netWeightKg ?? null,
    totalAmount: b.procurement?.totalAmount ?? null,
    billReference:
      b.procurement?.status === "COMPLETED"
        ? formatBillReference(b.procurement.id, b.procurement.createdAt)
        : null,
    paymentStatus: b.procurement?.payment?.status ?? null,
  }));

  const summary = {
    total: rows.length,
    waiting: rows.filter((r) => r.stage === "SLOT_BOOKED").length,
    arrived: rows.filter((r) => r.stage === "ARRIVED").length,
    verified: rows.filter((r) => r.stage === "VERIFIED").length,
    currentToken: centre?.currentToken ?? 0,
  };

  return res.json({ rows, summary, centreId });
}

// Search within today's queue at this operator's centre only — by
// token number, Farmer ID, or mobile number.
export async function searchQueue(req: Request, res: Response) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  const query = String(req.query.q || "").trim();
  if (!query) return res.json({ rows: [] });

  const tokenAsNumber = Number(query);

  const bookings = await prisma.booking.findMany({
    where: {
      status: { notIn: ["CANCELLED", "NO_SHOW"] }, // same reasoning as getTodayQueue above
      slot: { centreId, date: startOfToday() },
      OR: [
        ...(Number.isFinite(tokenAsNumber) ? [{ tokenNumber: tokenAsNumber }] : []),
        { caseId: { contains: query, mode: "insensitive" as const } },
        { farmer: { farmerCode: { contains: query, mode: "insensitive" as const } } },
        { farmer: { user: { mobile: { contains: query } } } },
      ],
    },
    include: {
      farmer: { include: { user: true } },
      queueEntry: true,
      procurement: { include: { qualityCheck: true, weighment: true, payment: true } },
    },
    orderBy: { tokenNumber: "asc" },
  });

  return res.json({
    rows: bookings.map((b) => ({
      bookingId: b.id,
      caseId: b.caseId,
      tokenNumber: b.tokenNumber,
      farmerName: b.farmer.fullName,
      farmerCode: b.farmer.farmerCode,
      mobile: b.farmer.user.mobile,
      crop: b.crop,
      quantityKg: b.quantityKg,
      stage: b.queueEntry?.stage ?? "SLOT_BOOKED",
      qualityResult: b.procurement?.qualityCheck?.result ?? null,
      netWeightKg: b.procurement?.weighment?.netWeightKg ?? null,
      totalAmount: b.procurement?.totalAmount ?? null,
      billReference:
        b.procurement?.status === "COMPLETED"
          ? formatBillReference(b.procurement.id, b.procurement.createdAt)
          : null,
      paymentStatus: b.procurement?.payment?.status ?? null,
    })),
  });
}

// Shared logic for any stage-advancing action: check the booking
// belongs to THIS operator's centre, check the workflow order is
// actually valid (can't verify someone who hasn't arrived yet), update
// the database, then tell that farmer's browser immediately.
async function advanceStage(
  req: Request,
  res: Response,
  requiredCurrentStage: string,
  nextStage: "ARRIVED" | "VERIFIED"
) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  const { bookingId } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true, queueEntry: true, farmer: true },
  });

  if (!booking || booking.slot.centreId !== centreId) {
    return res.status(404).json({ error: "Booking not found at your centre." });
  }
  if (!booking.queueEntry) {
    return res.status(400).json({ error: "This booking has no queue entry." });
  }
  if (booking.status !== "BOOKED") {
    return res.status(409).json({ error: "This booking was cancelled or marked as a no-show." });
  }
  if (booking.queueEntry.stage !== requiredCurrentStage) {
    return res.status(409).json({
      error: `This farmer's status is "${booking.queueEntry.stage}" — they must be "${requiredCurrentStage}" first.`,
    });
  }

  if (nextStage === "VERIFIED") {
    const docProblem = await documentsRuleError(booking.id);
    if (docProblem) return res.status(409).json({ error: docProblem });
  }

  const updated = await prisma.queueEntry.update({
    where: { id: booking.queueEntry.id },
    data: { stage: nextStage },
  });
  await recordStageChange(prisma, { id: booking.id, farmerId: booking.farmerId, tokenNumber: booking.tokenNumber, crop: booking.crop, centreId }, nextStage);

  // Real-time: the farmer's own dashboard updates instantly, the same
  // mechanism as the live token — never a page refresh needed.
  getIO().to(`centre:${centreId}`).emit("stage-updated", {
    centreId,
    bookingId: booking.id,
    stage: updated.stage,
  });

  const isArrival = nextStage === "ARRIVED";
  await logAudit({ userId: req.user!.userId, role: req.user!.role }, isArrival ? "MARK_ARRIVED" : "MARK_VERIFIED", {
    bookingId: booking.id,
    details: { token: booking.tokenNumber },
  });
  await notifyFarmer(
    booking.farmerId,
    isArrival ? "arrived" : "verified",
    isArrival ? "You have been marked as arrived at the centre." : "Your details have been verified."
  );

  return res.json({ message: `Marked as ${nextStage}.`, stage: updated.stage });
}

export async function markArrived(req: Request, res: Response) {
  return advanceStage(req, res, "SLOT_BOOKED", "ARRIVED");
}

// A farmer who never came. Only for bookings whose day has arrived, and
// only while they are still at "Slot booked". The booking leaves the live
// queue but stays in the history and audit log. The slot place is NOT
// given back, because the time really was reserved and unused.
export async function markNoShow(req: Request, res: Response) {
  try {
    const centreId = await getOperatorCentreId(req.user!.userId);
    if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: { slot: true, queueEntry: true },
    });
    if (!booking || booking.slot.centreId !== centreId) {
      return res.status(404).json({ error: "Booking not found at your centre." });
    }
    if (booking.status !== "BOOKED") {
      return res.status(409).json({ error: "This booking is no longer active." });
    }
    if ((booking.queueEntry?.stage ?? "SLOT_BOOKED") !== "SLOT_BOOKED") {
      return res.status(409).json({ error: "This farmer has already arrived, so they can't be marked as a no-show." });
    }
    if (booking.slot.date > startOfToday()) {
      return res.status(409).json({ error: "A no-show can only be recorded on or after the booking date." });
    }
    // The farmer sent an emergency request that nobody has decided yet: wait for the decision.
    if (await hasOpenEmergency(prisma, booking.id)) {
      return res.status(409).json({ error: "This farmer has an emergency request waiting for a decision, so a no-show can't be recorded yet." });
    }

    // Mark the no-show and give the reserved crop weight back in one step,
    // so the capacity numbers can never disagree with the booking status.
    const changedCount = await prisma.$transaction(async (tx) => {
      const changed = await tx.booking.updateMany({
        where: { id: booking.id, status: "BOOKED" },
        data: { status: "NO_SHOW" },
      });
      if (changed.count === 1) await releaseBookingCapacity(tx, booking.id);
      return changed.count;
    });
    if (changedCount === 0) return res.status(409).json({ error: "This booking is no longer active." });

    await onCapacityReleased({ slotId: booking.slotId, cropId: booking.cropId, kg: Math.round(booking.quantityKg), trigger: "NO_SHOW" });
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "MARK_NO_SHOW", {
      bookingId: booking.id,
      details: { token: booking.tokenNumber },
    });
    await notifyFarmer(
      booking.farmerId,
      "noShow",
      `You were marked as not arrived for token ${booking.tokenNumber}.`,
      { token: booking.tokenNumber }
    );
    try {
      getIO().to(`centre:${centreId}`).emit("stage-updated", {
        centreId,
        bookingId: booking.id,
        stage: "SLOT_BOOKED",
        status: "NO_SHOW",
      });
    } catch {
      /* live update is a bonus */
    }
    return res.json({ message: "Marked as no-show." });
  } catch (err) {
    console.error("markNoShow failed:", err);
    return res.status(500).json({ error: "Could not record the no-show. Please try again." });
  }
}

export async function markVerified(req: Request, res: Response) {
  return advanceStage(req, res, "ARRIVED", "VERIFIED");
}

const qualityCheckSchema = z.object({
  moisturePercent: z.number().min(0).max(100),
  foreignMatter: z.number().min(0).max(100),
  qualityGrade: z.string().min(1, "Grade is required."),
  remarks: z.string().optional(),
  result: z.enum(["ACCEPTED", "REJECTED"]),
});

export async function submitQualityCheck(req: Request, res: Response) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  const parsed = qualityCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { bookingId } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true, queueEntry: true },
  });

  if (!booking || booking.slot.centreId !== centreId) {
    return res.status(404).json({ error: "Booking not found at your centre." });
  }
  if (!booking.queueEntry || booking.queueEntry.stage !== "VERIFIED") {
    return res.status(409).json({
      error: `This farmer must be "VERIFIED" before a quality check can be recorded (currently: ${booking.queueEntry?.stage ?? "unknown"}).`,
    });
  }

  const procurement = await getOrCreateProcurement(bookingId);

  const existingCheck = await prisma.qualityCheck.findUnique({ where: { procurementId: procurement.id } });
  if (existingCheck) {
    return res.status(409).json({ error: "A quality check has already been recorded for this booking." });
  }

  const { moisturePercent, foreignMatter, qualityGrade, remarks, result } = parsed.data;

  const qualityCheck = await prisma.qualityCheck.create({
    data: { procurementId: procurement.id, moisturePercent, foreignMatter, qualityGrade, remarks, result },
  });

  await prisma.procurement.update({ where: { id: procurement.id }, data: { status: "QUALITY_CHECKED" } });
  const updatedEntry = await prisma.queueEntry.update({
    where: { id: booking.queueEntry.id },
    data: { stage: "QUALITY_CHECKED" },
  });
  await recordStageChange(prisma, { id: booking.id, farmerId: booking.farmerId, tokenNumber: booking.tokenNumber, crop: booking.crop, centreId }, "QUALITY_CHECKED");

  getIO().to(`centre:${centreId}`).emit("stage-updated", {
    centreId,
    bookingId: booking.id,
    stage: updatedEntry.stage,
    qualityResult: result,
  });

  await logAudit({ userId: req.user!.userId, role: req.user!.role }, "QUALITY_CHECK", {
    bookingId: booking.id,
    details: { token: booking.tokenNumber, result },
  });
  await notifyFarmer(
    booking.farmerId,
    result === "ACCEPTED" ? "qualityAccepted" : "qualityRejected",
    result === "ACCEPTED"
      ? "Quality check complete: your produce was accepted."
      : "Quality check complete: your produce was rejected."
  );

  return res.json({ message: "Quality check recorded.", qualityCheck });
}

const weighingSchema = z.object({
  grossWeightKg: z.number().positive(),
  tareWeightKg: z.number().min(0),
  remarks: z.string().optional(),
});

export async function submitWeighing(req: Request, res: Response) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  const parsed = weighingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { bookingId } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true, queueEntry: true },
  });
  if (!booking || booking.slot.centreId !== centreId) {
    return res.status(404).json({ error: "Booking not found at your centre." });
  }
  if (!booking.queueEntry || booking.queueEntry.stage !== "QUALITY_CHECKED") {
    return res.status(409).json({
      error: `This farmer must complete quality check first (currently: ${booking.queueEntry?.stage ?? "unknown"}).`,
    });
  }

  const procurement = await prisma.procurement.findUnique({
    where: { bookingId },
    include: { qualityCheck: true, weighment: true },
  });
  if (!procurement?.qualityCheck) {
    return res.status(409).json({ error: "No quality check found for this booking." });
  }
  if (procurement.qualityCheck.result !== "ACCEPTED") {
    return res.status(409).json({ error: "Rejected produce cannot proceed to weighing." });
  }
  if (procurement.weighment) {
    return res.status(409).json({ error: "This booking has already been weighed." });
  }

  const { grossWeightKg, tareWeightKg, remarks } = parsed.data;
  // Net weight is always calculated here on the server, from the
  // operator's two raw readings — never trusted as a pre-computed
  // number sent from the client.
  const netWeightKg = Math.max(0, grossWeightKg - tareWeightKg);

  const weighment = await prisma.weighment.create({
    data: { procurementId: procurement.id, grossWeightKg, netWeightKg, remarks },
  });

  await prisma.procurement.update({ where: { id: procurement.id }, data: { status: "WEIGHED" } });
  const updatedEntry = await prisma.queueEntry.update({
    where: { id: booking.queueEntry.id },
    data: { stage: "WEIGHED" },
  });
  await recordStageChange(prisma, { id: booking.id, farmerId: booking.farmerId, tokenNumber: booking.tokenNumber, crop: booking.crop, centreId }, "WEIGHED");

  getIO().to(`centre:${centreId}`).emit("stage-updated", {
    centreId,
    bookingId: booking.id,
    stage: updatedEntry.stage,
    netWeightKg,
  });

  await logAudit({ userId: req.user!.userId, role: req.user!.role }, "WEIGHING", {
    bookingId: booking.id,
    details: { token: booking.tokenNumber, kg: netWeightKg },
  });
  await notifyFarmer(booking.farmerId, "weighed", `Weighing complete. Net weight: ${netWeightKg} kg.`, {
    kg: netWeightKg,
  });

  return res.json({ message: "Weighing recorded.", weighment });
}

export async function completeProcurement(req: Request, res: Response) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  const { bookingId } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true, queueEntry: true },
  });
  if (!booking || booking.slot.centreId !== centreId) {
    return res.status(404).json({ error: "Booking not found at your centre." });
  }
  if (!booking.queueEntry || booking.queueEntry.stage !== "WEIGHED") {
    return res.status(409).json({
      error: `This farmer must be weighed first (currently: ${booking.queueEntry?.stage ?? "unknown"}).`,
    });
  }

  const procurement = await prisma.procurement.findUnique({
    where: { bookingId },
    include: { weighment: true },
  });
  if (!procurement?.weighment) {
    return res.status(409).json({ error: "No weighment found for this booking." });
  }
  if (procurement.status === "COMPLETED") {
    return res.status(409).json({ error: "This procurement has already been completed." });
  }

  const pricePerKg = getPricePerKg(procurement.crop);
  const totalAmount = Math.round(procurement.weighment.netWeightKg * pricePerKg * 100) / 100;

  const updated = await prisma.procurement.update({
    where: { id: procurement.id },
    data: {
      pricePerKg,
      totalAmount,
      status: "COMPLETED",
      operatorUserId: req.user!.userId,
    },
  });

  const updatedEntry = await prisma.queueEntry.update({
    where: { id: booking.queueEntry.id },
    data: { stage: "COMPLETED" },
  });
  await recordStageChange(prisma, { id: booking.id, farmerId: booking.farmerId, tokenNumber: booking.tokenNumber, crop: booking.crop, centreId }, "COMPLETED");

  // This is the fix for "a finished booking stays as the farmer's
  // current booking forever": Booking.status was never actually moved
  // off "BOOKED" anywhere in the app before this. Moving it to
  // "COMPLETED" here does two things at once — it lets the farmer
  // dashboard tell a finished booking apart from an active one, and it
  // naturally allows booking again the same day, since the duplicate-
  // booking check in createBooking only looks at status: "BOOKED".
  await prisma.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });

  // Creating this record IS "Bill Generated" — a farmer with a PENDING
  // payment has, by definition, a generated bill. No separate bill
  // table needed for that state.
  await prisma.payment.create({
    data: { procurementId: procurement.id, amount: totalAmount, status: "PENDING" },
  });

  const billReference = formatBillReference(updated.id, updated.createdAt);

  getIO().to(`centre:${centreId}`).emit("stage-updated", {
    centreId,
    bookingId: booking.id,
    stage: updatedEntry.stage,
    totalAmount,
    pricePerKg,
    billReference,
    paymentStatus: "PENDING",
  });

  await logAudit({ userId: req.user!.userId, role: req.user!.role }, "COMPLETE_PROCUREMENT", {
    bookingId: booking.id,
    details: { token: booking.tokenNumber, amount: totalAmount },
  });
  await notifyFarmer(
    booking.farmerId,
    "completed",
    `Procurement completed. Amount: ₹${totalAmount}. Bill ${billReference}.`,
    { amount: totalAmount, bill: billReference }
  );

  return res.json({
    message: "Procurement completed.",
    pricePerKg,
    netWeightKg: procurement.weighment.netWeightKg,
    totalAmount,
    billReference,
  });
}

// Shared logic for every payment status transition — same shape as
// advanceStage above: check centre ownership, check the transition is
// actually valid in order, update, broadcast live to the farmer.
async function advancePayment(
  req: Request,
  res: Response,
  requiredCurrentStatus: string,
  nextStatus: "INITIATED" | "PROCESSING" | "CREDITED" | "FAILED"
) {
  const centreId = await getOperatorCentreId(req.user!.userId);
  if (!centreId) return res.status(404).json({ error: "Operator profile not found." });

  const { bookingId } = req.params;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { slot: true } });
  if (!booking || booking.slot.centreId !== centreId) {
    return res.status(404).json({ error: "Booking not found at your centre." });
  }

  const procurement = await prisma.procurement.findUnique({
    where: { bookingId },
    include: { payment: true, farmer: { include: { user: true } } },
  });
  if (!procurement?.payment) {
    return res.status(404).json({ error: "No payment record found for this booking." });
  }
  if (nextStatus !== "FAILED" && procurement.payment.status !== requiredCurrentStatus) {
    return res.status(409).json({
      error: `Payment status is "${procurement.payment.status}" — it must be "${requiredCurrentStatus}" first.`,
    });
  }

  const updated = await prisma.payment.update({
    where: { id: procurement.payment.id },
    data: { status: nextStatus },
  });

  if (nextStatus === "CREDITED") {
    sendSms(
      procurement.farmer.user.mobile,
      `Payment of ₹${updated.amount} for your procurement has been credited. Thank you!`
    );
  }

  getIO().to(`centre:${centreId}`).emit("payment-updated", {
    centreId,
    bookingId: booking.id,
    paymentStatus: updated.status,
  });

  const paymentMeta = {
    INITIATED: { action: "PAYMENT_INITIATE", type: "paymentInitiated", text: "Your payment has been initiated." },
    PROCESSING: { action: "PAYMENT_PROCESS", type: "paymentProcessing", text: "Your payment is being processed." },
    CREDITED: {
      action: "PAYMENT_CREDIT",
      type: "paymentCredited",
      text: `Your payment of ₹${updated.amount} has been credited.`,
    },
    FAILED: {
      action: "PAYMENT_FAIL",
      type: "paymentFailed",
      text: "Your payment could not be completed. Please contact the centre.",
    },
  } as const;
  const meta = paymentMeta[nextStatus];
  await logAudit({ userId: req.user!.userId, role: req.user!.role }, meta.action, {
    bookingId: booking.id,
    details: { token: booking.tokenNumber, amount: updated.amount },
  });
  await notifyFarmer(procurement.farmerId, meta.type, meta.text, { amount: updated.amount });

  return res.json({ message: `Payment marked ${nextStatus}.`, status: updated.status });
}

export async function initiatePayment(req: Request, res: Response) {
  return advancePayment(req, res, "PENDING", "INITIATED");
}
export async function processPayment(req: Request, res: Response) {
  return advancePayment(req, res, "INITIATED", "PROCESSING");
}
export async function creditPayment(req: Request, res: Response) {
  return advancePayment(req, res, "PROCESSING", "CREDITED");
}
export async function failPayment(req: Request, res: Response) {
  return advancePayment(req, res, "", "FAILED");
}
