import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { getOrCreateSlotsForDate } from "../services/slotService";
import { recommendSlots, checkWeight, CapacityError } from "../services/capacityService";

const querySchema = z.object({
  centreId: z.string().uuid("A valid centre must be selected."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format."),
});

export async function getSlots(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  try {
    const slots = await getOrCreateSlotsForDate(parsed.data.centreId, parsed.data.date);
    res.json(
      slots.map((s) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity: s.capacity,
        bookedCount: s.bookedCount,
        available: s.capacity - s.bookedCount,
        isFull: s.bookedCount >= s.capacity,
      }))
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not load slots." });
  }
}

// ---------- Crop-aware availability and best-fit recommendation ----------
// GET /api/slots/recommend?centreId=&cropId=&date=&weightKg=
// Always computed from the live database numbers. weightKg is optional: without
// it, the farmer just sees each slot's capacity for the chosen crop.

const recommendSchema = z.object({
  centreId: z.string().uuid("A valid centre must be selected."),
  cropId: z.string().uuid("Please choose a crop."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format."),
  weightKg: z.string().optional(),
});

export async function getRecommendedSlots(req: Request, res: Response) {
  const parsed = recommendSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { centreId, cropId, date, weightKg } = parsed.data;

  try {
    if (date < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: "Please choose today or a later date.", code: "DATE_PAST" });
    }
    const crop = await prisma.crop.findUnique({ where: { id: cropId } });
    if (!crop || !crop.isActive) return res.status(404).json({ error: "This crop is not available for booking." });

    let weight: number | null = null;
    if (weightKg !== undefined && weightKg.trim() !== "") {
      weight = Number(weightKg);
      const problem = checkWeight(weight, crop);
      if (problem) return res.status(problem.status).json({ error: problem.message, code: problem.code });
    }

    const result = await recommendSlots(centreId, crop, date, weight);
    // Availability changes all the time — never let a browser reuse an old answer.
    res.set("Cache-Control", "no-store");
    return res.json({ ...result, cropName: crop.name, maxBookingKg: crop.maxBookingKg });
  } catch (err) {
    if (err instanceof CapacityError) return res.status(err.status).json({ error: err.message, code: err.code });
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not load slots." });
  }
}
