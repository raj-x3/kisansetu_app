// Officer-side view and configuration of crop-wise slot capacity.
//
// Staff (manager, officers) see their own centre only. An admin chooses a
// centre with ?centreId=. Changing capacity is limited to admin and manager
// (see capacityRoutes.ts).

import { Request, Response } from "express";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { getOrCreateSlotsForDate } from "../services/slotService";
import { ensureCapacityRows } from "../services/capacityService";
import { slotStatus, remainingOf } from "../utils/slotRecommend";
import { logAudit } from "../services/auditService";
import { getIO } from "../socket";
import { onCapacityReleased } from "../services/waitlistService";

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type CentreResult = { centreId: string } | { status: number; error: string };

// Staff are tied to one centre; an admin must say which one.
async function resolveCentre(req: Request): Promise<CentreResult> {
  if (req.user!.role === "ADMIN") {
    const id = String(req.query.centreId ?? req.body?.centreId ?? "");
    if (!z.string().uuid().safeParse(id).success) return { status: 400, error: "Please choose a centre." };
    const centre = await prisma.procurementCentre.findUnique({ where: { id } });
    if (!centre) return { status: 404, error: "Centre not found." };
    return { centreId: centre.id };
  }
  const op = await prisma.operator.findUnique({ where: { userId: req.user!.userId } });
  if (!op) return { status: 404, error: "Staff profile not found." };
  return { centreId: op.centreId };
}

// GET /api/capacity/overview?date=&cropId=&centreId=(admin)
export async function getOverview(req: Request, res: Response) {
  try {
    const centre = await resolveCentre(req);
    if ("error" in centre) return res.status(centre.status).json({ error: centre.error });
    const date = dateField.safeParse(req.query.date ?? todayStr());
    if (!date.success) return res.status(400).json({ error: date.error.errors[0].message });
    const cropId = typeof req.query.cropId === "string" && req.query.cropId ? req.query.cropId : null;

    const slots = await getOrCreateSlotsForDate(centre.centreId, date.data);
    const crops = await prisma.crop.findMany({
      where: { isActive: true, ...(cropId ? { id: cropId } : {}) },
      orderBy: { name: "asc" },
    });
    // Every active crop gets a row in every slot, so each can be seen and configured.
    for (const crop of crops) await ensureCapacityRows(prisma, slots, crop);

    const caps = await prisma.slotCapacity.findMany({
      where: { slotId: { in: slots.map((s) => s.id) }, cropId: { in: crops.map((c) => c.id) } },
    });
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const cropById = new Map(crops.map((c) => [c.id, c]));

    const rows = caps
      .map((c) => {
        const slot = slotById.get(c.slotId)!;
        const remaining = remainingOf(c.maxWeightKg, c.bookedWeightKg);
        return {
          slotId: c.slotId,
          cropId: c.cropId,
          cropName: cropById.get(c.cropId)!.name,
          startTime: slot.startTime,
          endTime: slot.endTime,
          maxWeightKg: c.maxWeightKg,
          bookedWeightKg: c.bookedWeightKg,
          remainingKg: remaining,
          utilizationPct: c.maxWeightKg > 0 ? Math.min(100, Math.round((c.bookedWeightKg / c.maxWeightKg) * 100)) : 100,
          confirmedFarmers: c.bookedCount,
          status: slotStatus(c.maxWeightKg, remaining, slot.bookedCount >= slot.capacity),
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.cropName.localeCompare(b.cropName));

    // Day totals come from the bookings themselves (active = booked or completed).
    const active = await prisma.booking.findMany({
      where: { status: { in: ["BOOKED", "COMPLETED"] }, slot: { centreId: centre.centreId, date: new Date(`${date.data}T00:00:00.000Z`) } },
      select: { quantityKg: true },
    });
    const byCrop = crops.map((crop) => {
      const mine = rows.filter((r) => r.cropId === crop.id);
      const max = mine.reduce((n, r) => n + r.maxWeightKg, 0);
      const booked = mine.reduce((n, r) => n + r.bookedWeightKg, 0);
      return {
        cropId: crop.id,
        cropName: crop.name,
        maxWeightKg: max,
        bookedWeightKg: booked,
        remainingKg: Math.max(0, max - booked),
        utilizationPct: max > 0 ? Math.round((booked / max) * 100) : 0,
        confirmedFarmers: mine.reduce((n, r) => n + r.confirmedFarmers, 0),
      };
    });

    res.set("Cache-Control", "no-store");
    return res.json({
      centreId: centre.centreId,
      date: date.data,
      rows,
      byCrop,
      totals: {
        expectedWeightKg: Math.round(active.reduce((n, b) => n + b.quantityKg, 0)),
        confirmedFarmers: active.length,
      },
    });
  } catch (err) {
    console.error("getOverview failed:", err);
    return res.status(500).json({ error: "Could not load capacity. Please try again." });
  }
}

const STATUSES: BookingStatus[] = ["BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"];

// GET /api/capacity/bookings?date=&slotId=&cropId=&status=&centreId=(admin)
export async function listCapacityBookings(req: Request, res: Response) {
  try {
    const centre = await resolveCentre(req);
    if ("error" in centre) return res.status(centre.status).json({ error: centre.error });
    const date = dateField.safeParse(req.query.date ?? todayStr());
    if (!date.success) return res.status(400).json({ error: date.error.errors[0].message });
    const slotId = typeof req.query.slotId === "string" && req.query.slotId ? req.query.slotId : null;
    const cropId = typeof req.query.cropId === "string" && req.query.cropId ? req.query.cropId : null;
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (status && !STATUSES.includes(status as BookingStatus)) {
      return res.status(400).json({ error: "Unknown status filter." });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        ...(status ? { status: status as BookingStatus } : {}),
        ...(cropId ? { cropId } : {}),
        ...(slotId ? { slotId } : {}),
        slot: { centreId: centre.centreId, date: new Date(`${date.data}T00:00:00.000Z`) },
      },
      include: { farmer: true, slot: true, queueEntry: true },
      orderBy: [{ slot: { startTime: "asc" } }, { tokenNumber: "asc" }],
      take: 500,
    });

    res.set("Cache-Control", "no-store");
    return res.json(
      bookings.map((b) => ({
        id: b.id,
        caseId: b.caseId,
        tokenNumber: b.tokenNumber,
        farmerName: b.farmer.fullName,
        crop: b.crop,
        quantityKg: b.quantityKg,
        slotId: b.slotId,
        startTime: b.slot.startTime,
        endTime: b.slot.endTime,
        status: b.status,
        stage: b.queueEntry?.stage ?? "SLOT_BOOKED",
      }))
    );
  } catch (err) {
    console.error("listCapacityBookings failed:", err);
    return res.status(500).json({ error: "Could not load bookings. Please try again." });
  }
}

const slotConfigSchema = z.object({
  slotId: z.string().uuid(),
  cropId: z.string().uuid(),
  maxWeightKg: z.number().int("Use a whole number of kg.").min(0, "Capacity cannot be negative.").max(1_000_000, "That is too large."),
  saveAsDefault: z.boolean().optional(),
});

// PUT /api/capacity/slot — set one crop's maximum in one slot.
export async function setSlotCapacity(req: Request, res: Response) {
  const parsed = slotConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { slotId, cropId, maxWeightKg, saveAsDefault } = parsed.data;

  try {
    const centre = await resolveCentre(req);
    if ("error" in centre) return res.status(centre.status).json({ error: centre.error });

    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot || slot.centreId !== centre.centreId) return res.status(404).json({ error: "Slot not found at this centre." });
    if (slot.date.toISOString().slice(0, 10) < todayStr()) {
      return res.status(409).json({ error: "Capacity of a past date can't be changed." });
    }
    const crop = await prisma.crop.findUnique({ where: { id: cropId } });
    if (!crop) return res.status(404).json({ error: "Crop not found." });

    await ensureCapacityRows(prisma, [slot], crop);
    // The guard lives in the WHERE clause: it only changes the row when the
    // new maximum is not below the weight already booked.
    const changed = await prisma.slotCapacity.updateMany({
      where: { slotId, cropId, bookedWeightKg: { lte: maxWeightKg } },
      data: { maxWeightKg, updatedAt: new Date() },
    });
    if (changed.count === 0) {
      const row = await prisma.slotCapacity.findUnique({ where: { slotId_cropId: { slotId, cropId } } });
      return res.status(409).json({
        error: `${row?.bookedWeightKg ?? 0} kg is already booked in this slot, so the capacity can't be set below that.`,
      });
    }

    if (saveAsDefault) {
      await prisma.capacityTemplate.upsert({
        where: { centreId_cropId_startTime: { centreId: centre.centreId, cropId, startTime: slot.startTime } },
        update: { maxWeightKg },
        create: { centreId: centre.centreId, cropId, startTime: slot.startTime, maxWeightKg },
      });
    }

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CAPACITY_UPDATE", {
      details: { cropName: crop.name, slotTime: slot.startTime, kg: maxWeightKg },
    });
    try {
      getIO().to(`centre:${centre.centreId}`).emit("capacity-updated", { centreId: centre.centreId });
    } catch {
      /* live update is a bonus */
    }
    // More room may now fit someone on the waitlist.
    await onCapacityReleased({ slotId, cropId, kg: 0, trigger: "CAPACITY_RAISED", actor: { userId: req.user!.userId, role: req.user!.role } });
    return res.json({ message: "Capacity saved.", savedAsDefault: Boolean(saveAsDefault) });
  } catch (err) {
    console.error("setSlotCapacity failed:", err);
    return res.status(500).json({ error: "Could not save the capacity. Please try again." });
  }
}
