// Thin HTTP wrappers around simulationService.ts. All admin-only.

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { logAudit } from "../services/auditService";
import {
  addSimulatedFarmers,
  advanceNextSimulatedStage,
  advanceNextSimulatedPayment,
  resetSimulation,
} from "../services/simulationService";

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const addFarmersSchema = z.object({
  centreId: z.string().uuid(),
  count: z.number().int().min(1).max(50),
});

export async function simulateAddFarmers(req: Request, res: Response) {
  const parsed = addFarmersSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const result = await addSimulatedFarmers(parsed.data.centreId, parsed.data.count);
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "SIMULATED_ADD_FARMERS", {
      details: { centreId: parsed.data.centreId, requested: parsed.data.count, added: result.added },
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not add simulated farmers." });
  }
}

// A dedicated, larger burst — same underlying action as "Add Farmers,"
// just sized (and named) to visibly push a centre toward the "high
// congestion" insight built in Module 15.
export async function simulateCongestion(req: Request, res: Response) {
  const parsed = z.object({ centreId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const result = await addSimulatedFarmers(parsed.data.centreId, 15);
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "SIMULATED_ADD_FARMERS", {
      details: { centreId: parsed.data.centreId, requested: 15, added: result.added, congestionDrill: true },
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not simulate congestion." });
  }
}

const centreOnlySchema = z.object({ centreId: z.string().uuid() });

// Advances the SAME shared current-token counter a real operator's
// "Call Next Farmer" button uses. If real farmers are also queued at
// this centre today, this genuinely moves their position — the
// frontend carries an explicit warning about this for exactly that
// reason. Deliberately allowed here since demonstrating the live queue
// updating is the whole point of this control.
export async function simulateCallNext(req: Request, res: Response) {
  const parsed = centreOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { centreId } = parsed.data;
  const today = startOfToday();

  try {
    const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
    if (!centre) return res.status(404).json({ error: "Centre not found." });

    const nextBooking = await prisma.booking.findFirst({
      where: { status: "BOOKED", slot: { centreId, date: today }, tokenNumber: { gt: centre.currentToken } },
      orderBy: { tokenNumber: "asc" },
    });
    if (!nextBooking) {
      return res.status(404).json({ error: "No more farmers waiting in today's queue for this centre." });
    }

    const updatedCentre = await prisma.procurementCentre.update({
      where: { id: centreId },
      data: { currentToken: nextBooking.tokenNumber },
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CALL_NEXT", {
      details: { token: nextBooking.tokenNumber, simulated: true },
    });

    getIO().to(`centre:${centreId}`).emit("queue-updated", { centreId, currentToken: updatedCentre.currentToken });

    return res.json({ currentToken: updatedCentre.currentToken });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not advance the queue." });
  }
}

export async function simulateCompleteStage(req: Request, res: Response) {
  const parsed = centreOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const result = await advanceNextSimulatedStage(parsed.data.centreId, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
    if (!result.advanced) {
      return res.status(404).json({ error: "No simulated farmers left to advance at this centre." });
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not advance the simulated farmer." });
  }
}

export async function simulatePayment(req: Request, res: Response) {
  const parsed = centreOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const result = await advanceNextSimulatedPayment(parsed.data.centreId, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
    if (!result.advanced) {
      return res.status(404).json({ error: "No simulated payments left to advance at this centre." });
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not advance the simulated payment." });
  }
}

export async function simulateReset(req: Request, res: Response) {
  try {
    const result = await resetSimulation();
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "SIMULATED_RESET", {
      details: { farmersRemoved: result.farmersRemoved },
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Could not reset simulation." });
  }
}
