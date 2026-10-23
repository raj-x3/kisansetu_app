import { Request, Response } from "express";
import { z } from "zod";
import { getOrCreateSlotsForDate } from "../services/slotService";

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
