import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";
import { z } from "zod";
import {
  computeCentreQueue,
  centreSummary,
  listCentreSummaries,
  farmerQueueView,
  congestionForecast,
  notifyTodaysFarmers,
  emitQueueChanged,
} from "../services/queueService";
import { sweepCentre } from "../services/waitlistService";
import { canAccessCentre } from "../utils/centreAccess";

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

// =====================================================================
// Live queue and wait-time estimates (Module 25)
// =====================================================================


// Every centre's live status, for the farmer's "how busy is it" list.
export async function listCentres(_req: Request, res: Response) {
  try {
    return res.json(await listCentreSummaries());
  } catch (err) {
    console.error("listCentres failed:", err);
    return res.status(500).json({ error: "Could not load centre status. Please try again." });
  }
}

export async function getCentreStatus(req: Request, res: Response) {
  try {
    const centre = await prisma.procurementCentre.findUnique({ where: { id: req.params.centreId } });
    if (!centre) return res.status(404).json({ error: "Centre not found." });
    return res.json(centreSummary(await computeCentreQueue(centre)));
  } catch (err) {
    console.error("getCentreStatus failed:", err);
    return res.status(500).json({ error: "Could not load centre status. Please try again." });
  }
}

// The logged-in farmer's own position and estimate. The farmer is found from
// the login token, never from an id sent by the browser.
export async function getMyEstimate(req: Request, res: Response) {
  try {
    const view = await farmerQueueView(req.user!.userId);
    if (!view) return res.status(404).json({ error: "Farmer profile not found." });
    return res.json(view);
  } catch (err) {
    console.error("getMyEstimate failed:", err);
    return res.status(500).json({ error: "Could not load your queue status. Please try again." });
  }
}

// Staff: which centre am I working at? (An admin chooses one in the screen.)
export async function getMyCentre(req: Request, res: Response) {
  try {
    const op = await prisma.operator.findUnique({ where: { userId: req.user!.userId }, include: { centre: true } });
    if (!op) return res.status(404).json({ error: "Staff profile not found." });
    return res.json({ centreId: op.centreId, centreName: op.centre.name });
  } catch (err) {
    console.error("getMyCentre failed:", err);
    return res.status(500).json({ error: "Could not load your centre. Please try again." });
  }
}

// Staff: estimate for one token at a centre.
export async function getTokenEstimate(req: Request, res: Response) {
  try {
    if (!(await canAccessCentre(req.user!.userId, req.user!.role, req.params.centreId))) {
      return res.status(403).json({ error: "You can only view your own centre." });
    }
    const centre = await prisma.procurementCentre.findUnique({ where: { id: req.params.centreId } });
    if (!centre) return res.status(404).json({ error: "Centre not found." });
    const token = Number(req.params.tokenNumber);
    const q = await computeCentreQueue(centre);
    const row = q.rows.find((r) => r.tokenNumber === token);
    if (!row) return res.status(404).json({ error: "That token is not waiting in today's queue." });
    return res.json({ token, stage: row.stage, farmersAhead: row.farmersAhead, estimate: row.estimate, level: q.level });
  } catch (err) {
    console.error("getTokenEstimate failed:", err);
    return res.status(500).json({ error: "Could not calculate the estimate. Please try again." });
  }
}

// Staff: queue size, expected arrivals, predicted queue, counter use, bottlenecks.
export async function getCongestion(req: Request, res: Response) {
  try {
    if (!(await canAccessCentre(req.user!.userId, req.user!.role, req.params.centreId))) {
      return res.status(403).json({ error: "You can only view your own centre." });
    }
    const centre = await prisma.procurementCentre.findUnique({ where: { id: req.params.centreId } });
    if (!centre) return res.status(404).json({ error: "Centre not found." });
    return res.json(await congestionForecast(centre));
  } catch (err) {
    console.error("getCongestion failed:", err);
    return res.status(500).json({ error: "Could not load the congestion outlook. Please try again." });
  }
}

const statusSchema = z.object({
  activeCounters: z.number().int().min(1).max(50).nullable().optional(),
  paused: z.boolean().optional(),
  pauseReason: z.string().trim().max(200).optional(),
  delayMinutes: z.number().int().min(0).max(480).optional(),
  delayNote: z.string().trim().max(200).optional(),
});

// Staff report counters, a pause or a delay. Real database change, then
// farmers are told and every open screen refreshes.
export async function updateCentreStatus(req: Request, res: Response) {
  try {
    const { centreId } = req.params;
    if (!(await canAccessCentre(req.user!.userId, req.user!.role, centreId))) {
      return res.status(403).json({ error: "You can only change your own centre." });
    }
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const before = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
    if (!before) return res.status(404).json({ error: "Centre not found." });
    const d = parsed.data;
    if (d.paused === true && !(d.pauseReason ?? before.pauseReason)) {
      return res.status(400).json({ error: "Please give a short reason for pausing." });
    }

    const after = await prisma.procurementCentre.update({
      where: { id: centreId },
      data: {
        ...(d.activeCounters !== undefined ? { activeCounters: d.activeCounters } : {}),
        ...(d.paused !== undefined ? { isPaused: d.paused, pauseReason: d.paused ? d.pauseReason ?? before.pauseReason : null } : {}),
        ...(d.delayMinutes !== undefined ? { delayMinutes: d.delayMinutes, delayNote: d.delayMinutes > 0 ? d.delayNote ?? before.delayNote : null } : {}),
      },
    });
    const actor = { userId: req.user!.userId, role: req.user!.role };
    await logAudit(actor, "QUEUE_STATUS_UPDATE", {
      details: {
        counters: after.activeCounters ?? 0,
        paused: after.isPaused,
        delay: after.delayMinutes,
      },
    });

    if (d.paused === true && !before.isPaused) {
      await notifyTodaysFarmers(
        centreId,
        "queuePaused",
        `Procurement at ${after.name} is temporarily paused${after.pauseReason ? `: ${after.pauseReason}` : ""}. We will tell you when it resumes.`,
        { centre: after.name, reason: after.pauseReason ?? "" },
        true
      );
    }
    if (d.paused === false && before.isPaused) {
      await notifyTodaysFarmers(centreId, "queueResumed", `Procurement at ${after.name} has resumed.`, { centre: after.name }, true);
      await sweepCentre(centreId, "RESUMED", actor); // room may have been waiting during the pause
    }
    if (d.delayMinutes !== undefined && d.delayMinutes >= 10 && d.delayMinutes > before.delayMinutes) {
      await notifyTodaysFarmers(
        centreId,
        "centreDelayed",
        `Processing at ${after.name} is running about ${d.delayMinutes} minutes late.`,
        { centre: after.name, minutes: d.delayMinutes },
        false
      );
    }
    emitQueueChanged(centreId);
    return res.json({ message: "Centre status updated." });
  } catch (err) {
    console.error("updateCentreStatus failed:", err);
    return res.status(500).json({ error: "Could not update the centre status. Please try again." });
  }
}
