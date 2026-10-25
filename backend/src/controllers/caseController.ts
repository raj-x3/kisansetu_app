// Case timeline: the step-by-step history of one booking, built from the
// audit log (which already records who did what and when).
//
// Who may look:
//   - the farmer who owns the booking,
//   - any officer / manager at the booking's centre,
//   - an admin.
// Farmers see which KIND of person acted (for example "Gate officer"),
// never the officer's name.

import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";

// Only these facts are ever sent out, so nothing unexpected in a stored
// details object can leak to the screen.
const SAFE_DETAIL_KEYS = ["token", "result", "kg", "amount", "docType", "docStatus", "fromStage", "toStage", "toStatus"];

function pickSafeDetails(details: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (details && typeof details === "object") {
    for (const key of SAFE_DETAIL_KEYS) {
      const v = (details as Record<string, unknown>)[key];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}

export async function getCaseTimeline(req: Request, res: Response) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: { slot: { include: { centre: true } }, farmer: true, queueEntry: true },
    });
    if (!booking) return res.status(404).json({ error: "Case not found." });

    const { userId, role } = req.user!;
    const isFarmer = role === "FARMER";
    if (isFarmer) {
      if (booking.farmer.userId !== userId) return res.status(404).json({ error: "Case not found." });
    } else if (role !== "ADMIN") {
      const staff = await prisma.operator.findUnique({ where: { userId } });
      if (!staff || staff.centreId !== booking.slot.centreId) {
        return res.status(404).json({ error: "Case not found." });
      }
    }

    const logs = await prisma.auditLog.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
    });

    return res.json({
      caseId: booking.caseId,
      tokenNumber: booking.tokenNumber,
      crop: booking.crop,
      quantityKg: booking.quantityKg,
      centreName: booking.slot.centre.name,
      status: booking.status,
      stage: booking.queueEntry?.stage ?? "SLOT_BOOKED",
      events: logs.map((l) => ({
        id: l.id,
        action: l.action,
        at: l.createdAt,
        actorRole: l.actorRole,
        // Staff see names; farmers do not.
        actorName: isFarmer ? null : l.actorName,
        details: pickSafeDetails(l.details),
      })),
    });
  } catch (err) {
    console.error("getCaseTimeline failed:", err);
    return res.status(500).json({ error: "Could not load the timeline." });
  }
}
