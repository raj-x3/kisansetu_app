import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// A simple, explainable congestion signal — not a black box. It
// compares how many farmers are actually waiting right now against how
// much of this specific centre's processing capacity (machines ×
// operators) is available to serve them. The same queue length means
// very different things at a well-staffed centre versus an
// under-staffed one, so this is centre-relative rather than a fixed
// number of people.
type CrowdLevel = "LOW" | "MEDIUM" | "HIGH";

function computeCrowdLevel(farmersAhead: number, numMachines: number, numOperators: number): CrowdLevel {
  const capacity = Math.max(numMachines * numOperators, 1);
  const ratio = farmersAhead / capacity;
  if (ratio < 1.5) return "LOW";
  if (ratio < 4) return "MEDIUM";
  return "HIGH";
}

// A farmer's own live queue position — current token, their token,
// and how many people are still ahead of them.
export async function getMyPosition(req: Request, res: Response) {
  const userId = req.user!.userId;
  const farmer = await prisma.farmer.findUnique({ where: { userId } });
  if (!farmer) return res.status(404).json({ error: "Farmer profile not found." });

  const booking = await prisma.booking.findFirst({
    where: { farmerId: farmer.id, status: "BOOKED" },
    include: { slot: { include: { centre: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (!booking) {
    return res.json({ hasBooking: false });
  }

  const farmersAhead = await prisma.booking.count({
    where: {
      status: "BOOKED",
      slot: { centreId: booking.slot.centreId, date: booking.slot.date },
      tokenNumber: { gt: booking.slot.centre.currentToken, lt: booking.tokenNumber },
    },
  });

  const crowdLevel = computeCrowdLevel(
    farmersAhead,
    booking.slot.centre.numMachines,
    booking.slot.centre.numOperators
  );

  return res.json({
    hasBooking: true,
    centreId: booking.slot.centreId,
    centreName: booking.slot.centre.name,
    currentToken: booking.slot.centre.currentToken,
    yourToken: booking.tokenNumber,
    farmersAhead,
    crowdLevel,
    centreCapacity: booking.slot.centre.numMachines * booking.slot.centre.numOperators,
  });
}

// Operator-only: advance the queue to the next booked farmer for their
// centre today. This is the ONE action that actually changes the
// database and notifies every connected farmer — nothing here is a
// frontend-only fake update.
export async function callNext(req: Request, res: Response) {
  const userId = req.user!.userId;
  const operator = await prisma.operator.findUnique({ where: { userId } });
  if (!operator) return res.status(404).json({ error: "Operator profile not found." });

  const centreId = operator.centreId;
  const today = startOfToday();

  const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
  if (!centre) return res.status(404).json({ error: "Centre not found." });

  const nextBooking = await prisma.booking.findFirst({
    where: {
      status: "BOOKED",
      slot: { centreId, date: today },
      tokenNumber: { gt: centre.currentToken },
    },
    orderBy: { tokenNumber: "asc" },
    include: { queueEntry: true },
  });

  if (!nextBooking) {
    return res.status(404).json({ error: "No more farmers waiting in today's queue for your centre." });
  }

  const updatedCentre = await prisma.procurementCentre.update({
    where: { id: centreId },
    data: { currentToken: nextBooking.tokenNumber },
  });

  if (nextBooking.queueEntry) {
    await prisma.queueEntry.update({
      where: { id: nextBooking.queueEntry.id },
      data: { calledAt: new Date() },
    });
  }

  // Broadcast the new current token to every farmer whose browser has
  // joined this centre's room — this is what makes dashboards update
  // instantly without a page refresh.
  getIO().to(`centre:${centreId}`).emit("queue-updated", {
    centreId,
    currentToken: updatedCentre.currentToken,
  });

  await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CALL_NEXT", { details: { token: nextBooking.tokenNumber } });

  // Tell the farmer whose turn it is, and warn the one who is two places
  // behind (found by order, so skipped/missing tokens don't matter).
  await notifyFarmer(nextBooking.farmerId, "yourTurn", `It's your turn — token ${nextBooking.tokenNumber} is now being served.`, {
    token: nextBooking.tokenNumber,
  });
  const upcoming = await prisma.booking.findMany({
    where: {
      status: "BOOKED",
      slot: { centreId, date: today },
      tokenNumber: { gt: nextBooking.tokenNumber },
    },
    orderBy: { tokenNumber: "asc" },
    take: 2,
  });
  if (upcoming[1]) {
    await notifyFarmer(
      upcoming[1].farmerId,
      "approaching",
      `Your token ${upcoming[1].tokenNumber} is approaching — about 2 farmers ahead of you.`,
      { token: upcoming[1].tokenNumber }
    );
  }

  return res.json({
    message: "Advanced to next farmer.",
    currentToken: updatedCentre.currentToken,
    calledTokenNumber: nextBooking.tokenNumber,
  });
}
