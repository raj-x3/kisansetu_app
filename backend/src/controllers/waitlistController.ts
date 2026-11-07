// Waitlist and slot offers: farmer actions and officer management.

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import {
  WaitlistError,
  joinWaitlist,
  withdrawEntry,
  acceptOffer,
  declineOffer,
  farmerWaitlistView,
  officerOverview,
  manualRedistribute,
  setWaitlistPaused,
  setOfferWindow,
} from "../services/waitlistService";
import { CapacityError } from "../services/capacityService";
import { canAccessCentre } from "../utils/centreAccess";

function fail(res: Response, err: unknown, fallback: string) {
  if (err instanceof WaitlistError || err instanceof CapacityError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

// ---------- Farmer ----------

const joinSchema = z.object({
  centreId: z.string().uuid("Please choose a centre."),
  cropId: z.string().uuid("Please choose a crop."),
  quantityKg: z.number({ invalid_type_error: "Enter your estimated weight in kilograms." }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date."),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export async function join(req: Request, res: Response) {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  try {
    const entry = await joinWaitlist(req.user!.userId, parsed.data);
    return res.status(201).json({ message: "Added to the waitlist.", id: entry.id });
  } catch (err) {
    return fail(res, err, "Could not add you to the waitlist. Please try again.");
  }
}

export async function mine(req: Request, res: Response) {
  try {
    return res.json(await farmerWaitlistView(req.user!.userId));
  } catch (err) {
    return fail(res, err, "Could not load your waitlist. Please try again.");
  }
}

export async function withdraw(req: Request, res: Response) {
  try {
    await withdrawEntry(req.user!.userId, req.params.id);
    return res.json({ message: "Removed from the waitlist." });
  } catch (err) {
    return fail(res, err, "Could not remove you from the waitlist. Please try again.");
  }
}

// Offers made for one of the farmer's own entries.
export async function entryOffers(req: Request, res: Response) {
  try {
    const farmer = await prisma.farmer.findUnique({ where: { userId: req.user!.userId } });
    if (!farmer) return res.status(404).json({ error: "Farmer profile not found." });
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: req.params.id } });
    if (!entry || entry.farmerId !== farmer.id) return res.status(404).json({ error: "Waitlist entry not found." });
    const offers = await prisma.slotOffer.findMany({ where: { waitlistId: entry.id }, include: { slot: true }, orderBy: { createdAt: "desc" } });
    return res.json(
      offers.map((o) => ({
        id: o.id,
        status: o.status === "PENDING" && o.expiresAt <= new Date() ? "EXPIRED" : o.status,
        date: o.slot.date,
        startTime: o.slot.startTime,
        endTime: o.slot.endTime,
        quantityKg: o.quantityKg,
        expiresAt: o.expiresAt,
      }))
    );
  } catch (err) {
    return fail(res, err, "Could not load the offers. Please try again.");
  }
}

export async function accept(req: Request, res: Response) {
  try {
    const booking = await acceptOffer(req.user!.userId, req.params.id);
    return res.status(201).json({ message: "Slot confirmed.", booking });
  } catch (err) {
    return fail(res, err, "Could not confirm the slot. Please try again.");
  }
}

export async function decline(req: Request, res: Response) {
  try {
    await declineOffer(req.user!.userId, req.params.id);
    return res.json({ message: "Offer declined." });
  } catch (err) {
    return fail(res, err, "Could not decline the offer. Please try again.");
  }
}

// ---------- Officers ----------

async function guard(req: Request, res: Response): Promise<string | null> {
  const { centreId } = req.params;
  if (!(await canAccessCentre(req.user!.userId, req.user!.role, centreId))) {
    res.status(403).json({ error: "You can only manage the waitlist of your own centre." });
    return null;
  }
  return centreId;
}

export async function officerList(req: Request, res: Response) {
  try {
    const centreId = await guard(req, res);
    if (!centreId) return;
    return res.json(await officerOverview(centreId));
  } catch (err) {
    return fail(res, err, "Could not load the waitlist. Please try again.");
  }
}

const reasonSchema = z.object({ reason: z.string().trim().min(5, "Please give a reason (at least 5 characters).").max(300) });

export async function officerRedistribute(req: Request, res: Response) {
  try {
    const centreId = await guard(req, res);
    if (!centreId) return;
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const r = await manualRedistribute(centreId, { userId: req.user!.userId, role: req.user!.role }, parsed.data.reason);
    return res.json({ message: "Redistribution run.", offered: r.offered });
  } catch (err) {
    return fail(res, err, "Could not run redistribution. Please try again.");
  }
}

const pauseSchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

export async function officerPause(req: Request, res: Response) {
  try {
    const centreId = await guard(req, res);
    if (!centreId) return;
    const parsed = pauseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    if (parsed.data.paused && (parsed.data.reason ?? "").length < 5) {
      return res.status(400).json({ error: "Please give a reason for pausing (at least 5 characters)." });
    }
    await setWaitlistPaused(centreId, parsed.data.paused, parsed.data.reason ?? null, { userId: req.user!.userId, role: req.user!.role });
    return res.json({ message: parsed.data.paused ? "Redistribution paused." : "Redistribution resumed." });
  } catch (err) {
    return fail(res, err, "Could not change the setting. Please try again.");
  }
}

export async function officerOfferWindow(req: Request, res: Response) {
  try {
    const centreId = await guard(req, res);
    if (!centreId) return;
    const parsed = z.object({ minutes: z.number().int() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter the number of minutes." });
    await setOfferWindow(centreId, parsed.data.minutes, { userId: req.user!.userId, role: req.user!.role });
    return res.json({ message: "Offer time updated." });
  } catch (err) {
    return fail(res, err, "Could not update the offer time. Please try again.");
  }
}
