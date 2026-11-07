// Crops are data, not code: an admin or manager adds a new crop here and it
// immediately appears on the booking page and the capacity screens, with no
// code change. Wheat, Paddy and the rest come from the seed file as ordinary rows.

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { logAudit } from "../services/auditService";

// Public: the booking page needs this before login finishes loading.
export async function listActiveCrops(_req: Request, res: Response) {
  try {
    const crops = await prisma.crop.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    res.json(crops.map((c) => ({ id: c.id, name: c.name, maxBookingKg: c.maxBookingKg })));
  } catch (err) {
    console.error("listActiveCrops failed:", err);
    res.status(500).json({ error: "Could not load crops." });
  }
}

// Staff: every crop, including switched-off ones, with its settings.
export async function listAllCrops(_req: Request, res: Response) {
  try {
    const crops = await prisma.crop.findMany({ orderBy: { name: "asc" } });
    res.json(crops);
  } catch (err) {
    console.error("listAllCrops failed:", err);
    res.status(500).json({ error: "Could not load crops." });
  }
}

const kgField = z.number().int("Use a whole number of kg.").min(1, "Must be at least 1 kg.").max(1_000_000, "That is too large.");

const createSchema = z.object({
  name: z.string().trim().min(2, "Crop name is too short.").max(40, "Crop name is too long."),
  defaultSlotCapacityKg: kgField,
  maxBookingKg: kgField,
});

export async function createCrop(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  try {
    const exists = await prisma.crop.findFirst({ where: { name: { equals: parsed.data.name, mode: "insensitive" } } });
    if (exists) return res.status(409).json({ error: `${exists.name} is already in the list.` });
    const crop = await prisma.crop.create({ data: parsed.data });
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CROP_CREATE", {
      details: { cropName: crop.name, kg: crop.defaultSlotCapacityKg },
    });
    return res.status(201).json(crop);
  } catch (err) {
    console.error("createCrop failed:", err);
    return res.status(500).json({ error: "Could not add the crop. Please try again." });
  }
}

const updateSchema = z.object({
  isActive: z.boolean().optional(),
  defaultSlotCapacityKg: kgField.optional(),
  maxBookingKg: kgField.optional(),
});

export async function updateCrop(req: Request, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Nothing to change." });
  try {
    const crop = await prisma.crop.findUnique({ where: { id: req.params.id } });
    if (!crop) return res.status(404).json({ error: "Crop not found." });
    // Switching a crop off only hides it from new bookings. Existing bookings
    // and their capacity are untouched.
    const updated = await prisma.crop.update({ where: { id: crop.id }, data: parsed.data });
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CROP_UPDATE", {
      details: { cropName: updated.name },
    });
    return res.json(updated);
  } catch (err) {
    console.error("updateCrop failed:", err);
    return res.status(500).json({ error: "Could not update the crop. Please try again." });
  }
}
