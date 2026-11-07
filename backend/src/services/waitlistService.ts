// Automatic waitlist and slot redistribution.
//
// Life of a waitlist entry:
//   ACTIVE  -> a slot with room appears -> an OFFER is created, the room is
//              held for that farmer (entry OFFERED)
//   OFFERED -> farmer accepts  -> a real booking is made, entry FULFILLED
//           -> declines/expires -> the hold is released, entry back to ACTIVE,
//                                  and the next farmer in line is offered the room
//   Withdrawn by the farmer at any time.
//
// Safety:
//   * Every hold uses the same atomic capacity update as normal booking
//     (reserveWeight), so room can never be given to two people.
//   * Releasing a hold is a guarded flip of `reservationHeld`, so it happens once.
//   * Accepting is a guarded flip of the offer status, so only one accept wins.
//   * Redistribution for one slot+crop runs under a row lock, so two cancellations
//     at the same moment cannot both hand out the same room.

import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { queueConfig } from "../config/queue";
import { nextCaseId } from "../utils/caseId";
import { nextTokenNumber } from "../utils/tokenNumber";
import { slotTimesMs } from "./emergencyService";
import { getCropSlotInputs, checkWeight, reserveWeight, releaseRaw } from "./capacityService";
import { rankSlots } from "../utils/slotRecommend";
import {
  MatchEntry,
  MatchSlot,
  MatchContext,
  planOffers,
  evaluateEntry,
  SkipReason,
} from "../utils/waitlistMatch";
import { notifyFarmer } from "./notificationService";
import { sendSms } from "./smsService";
import { logAudit } from "./auditService";

type Tx = Prisma.TransactionClient;
type Actor = { userId: string; role: string } | null;

export class WaitlistError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

const dstr = (d: Date) => d.toISOString().slice(0, 10);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function emitCentre(centreId: string, event: string) {
  try {
    getIO().to(`centre:${centreId}`).emit(event, { centreId });
  } catch {
    /* live update is a bonus */
  }
}
function emitUser(userId: string, event: string) {
  try {
    getIO().to(`user:${userId}`).emit(event, {});
  } catch {
    /* live update is a bonus */
  }
}

interface LogRow {
  centreId: string;
  event: string;
  slotId?: string | null;
  cropId?: string | null;
  cropName?: string;
  slotDate?: Date | null;
  slotStart?: string | null;
  trigger?: string | null;
  kg?: number;
  waitlistId?: string | null;
  offerId?: string | null;
  farmerCode?: string | null;
  reason?: string | null;
  params?: Record<string, string | number> | null;
  actor?: Actor;
  note?: string | null;
}

async function logAllocation(db: Tx, r: LogRow): Promise<void> {
  try {
    await db.allocationLog.create({
      data: {
        centreId: r.centreId,
        event: r.event,
        slotId: r.slotId ?? null,
        cropId: r.cropId ?? null,
        cropName: r.cropName ?? "",
        slotDate: r.slotDate ?? null,
        slotStart: r.slotStart ?? null,
        trigger: r.trigger ?? null,
        kg: r.kg ?? 0,
        waitlistId: r.waitlistId ?? null,
        offerId: r.offerId ?? null,
        farmerCode: r.farmerCode ?? null,
        reason: r.reason ?? null,
        params: (r.params ?? undefined) as Prisma.InputJsonObject | undefined,
        actorUserId: r.actor?.userId ?? null,
        actorRole: r.actor?.role ?? null,
        note: r.note ?? null,
      },
    });
  } catch (err) {
    console.error("allocation log failed:", err);
  }
}

// ---------- Matching context ----------

function toMatchEntry(e: { id: string; farmerId: string; centreId: string; cropId: string; quantityKg: number; preferredDate: Date; windowStart: string | null; windowEnd: string | null; createdAt: Date; status: string }): MatchEntry {
  return {
    id: e.id,
    farmerId: e.farmerId,
    centreId: e.centreId,
    cropId: e.cropId,
    quantityKg: e.quantityKg,
    preferredDate: dstr(e.preferredDate),
    windowStart: e.windowStart,
    windowEnd: e.windowEnd,
    createdAtMs: e.createdAt.getTime(),
    status: e.status as MatchEntry["status"],
  };
}

async function buildContext(db: Tx, entries: MatchEntry[], slotIds: string[]): Promise<MatchContext> {
  const farmerIds = [...new Set(entries.map((e) => e.farmerId))];
  const dates = [...new Set(entries.map((e) => e.preferredDate))].map((d) => new Date(`${d}T00:00:00.000Z`));
  const bookedDates = new Map<string, Set<string>>();
  const pendingOfferDates = new Map<string, Set<string>>();
  if (farmerIds.length > 0) {
    const booked = await db.booking.findMany({
      where: { farmerId: { in: farmerIds }, status: "BOOKED", slot: { date: { in: dates } } },
      select: { farmerId: true, slot: { select: { date: true } } },
    });
    for (const b of booked) {
      const s = bookedDates.get(b.farmerId) ?? new Set<string>();
      s.add(dstr(b.slot.date));
      bookedDates.set(b.farmerId, s);
    }
    const pending = await db.slotOffer.findMany({
      where: { farmerId: { in: farmerIds }, status: "PENDING" },
      select: { farmerId: true, slot: { select: { date: true } } },
    });
    for (const o of pending) {
      const s = pendingOfferDates.get(o.farmerId) ?? new Set<string>();
      s.add(dstr(o.slot.date));
      pendingOfferDates.set(o.farmerId, s);
    }
  }
  const offeredBefore = new Set<string>();
  if (entries.length > 0 && slotIds.length > 0) {
    const prior = await db.slotOffer.findMany({
      where: { waitlistId: { in: entries.map((e) => e.id) }, slotId: { in: slotIds } },
      select: { waitlistId: true, slotId: true },
    });
    for (const o of prior) offeredBefore.add(`${o.waitlistId}|${o.slotId}`);
  }
  return { nowMs: Date.now(), bookedDates, pendingOfferDates, offeredBefore };
}

// ---------- Handing out released room ----------

interface CreatedOffer {
  offerId: string;
  farmerId: string;
}

// Gives the room in one slot (for one crop) to waitlisted farmers, first come
// first served. Safe to call any number of times; it only ever offers room
// that is really free.
export async function redistributeSlot(
  slotId: string,
  cropId: string,
  trigger: string,
  actor: Actor = null
): Promise<{ offered: number; blocked?: "PAUSED" | "PAST" }> {
  const slot = await prisma.slot.findUnique({ where: { id: slotId }, include: { centre: true } });
  if (!slot) return { offered: 0 };
  const centre = slot.centre;
  const crop = await prisma.crop.findUnique({ where: { id: cropId } });
  if (!crop) return { offered: 0 };
  const times = slotTimesMs(slot.date, slot.startTime, slot.endTime);
  if (times.endMs <= Date.now()) return { offered: 0, blocked: "PAST" };

  const base = { centreId: centre.id, slotId, cropId, cropName: crop.name, slotDate: slot.date, slotStart: slot.startTime, trigger, actor };
  if (centre.waitlistPaused || centre.isPaused || !centre.isActive) {
    const waiting = await prisma.waitlistEntry.count({ where: { centreId: centre.id, cropId, preferredDate: slot.date, status: "ACTIVE" } });
    if (waiting > 0) {
      await logAllocation(prisma, { ...base, event: "PAUSED", reason: centre.waitlistPaused ? "waitlistPaused" : "centrePaused" });
    }
    return { offered: 0, blocked: "PAUSED" };
  }

  const created: CreatedOffer[] = [];
  await prisma.$transaction(
    async (tx) => {
      // Serialise everyone working on this slot+crop.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM slot_capacities WHERE slot_id = ${slotId} AND crop_id = ${cropId} FOR UPDATE`;
      if (locked.length === 0) return;
      const cap = await tx.slotCapacity.findUniqueOrThrow({ where: { slotId_cropId: { slotId, cropId } } });
      const fresh = await tx.slot.findUniqueOrThrow({ where: { id: slotId } });
      const remaining = Math.max(0, cap.maxWeightKg - cap.bookedWeightKg);

      const rows = await tx.waitlistEntry.findMany({
        where: { centreId: centre.id, cropId, preferredDate: slot.date, status: "ACTIVE" },
        include: { farmer: { select: { farmerCode: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (rows.length === 0) return;
      const entries = rows.map(toMatchEntry);
      const code = new Map(rows.map((r) => [r.id, r.farmer.farmerCode]));
      const ctx = await buildContext(tx, entries, [slotId]);
      const matchSlot: MatchSlot = {
        slotId,
        centreId: centre.id,
        cropId,
        date: dstr(slot.date),
        startTime: slot.startTime,
        endTime: slot.endTime,
        remainingKg: remaining,
        placesLeft: Math.max(0, fresh.capacity - fresh.bookedCount),
        endMs: times.endMs,
      };
      const plan = planOffers(matchSlot, entries, ctx);

      for (const d of plan.decisions) {
        if (d.eligible) continue;
        await logAllocation(tx, {
          ...base,
          event: "SKIPPED",
          waitlistId: d.entryId,
          farmerCode: code.get(d.entryId),
          reason: d.reason,
          params: d.shortfallKg ? { shortfallKg: d.shortfallKg } : null,
          kg: remaining,
        });
      }

      const expiresAt = new Date(Date.now() + centre.offerWindowMin * 60_000);
      for (const o of plan.offers) {
        // 1. take the entry (guarded: it must still be ACTIVE)
        const flip = await tx.waitlistEntry.updateMany({ where: { id: o.entryId, status: "ACTIVE" }, data: { status: "OFFERED" } });
        if (flip.count === 0) continue;
        // 2. take a farmer place, then the weight; undo this farmer's steps if one fails
        const place = await tx.slot.updateMany({ where: { id: slotId, bookedCount: { lt: fresh.capacity } }, data: { bookedCount: { increment: 1 } } });
        if (place.count === 0) {
          await tx.waitlistEntry.updateMany({ where: { id: o.entryId }, data: { status: "ACTIVE" } });
          continue;
        }
        const held = await reserveWeight(tx, slotId, cropId, o.quantityKg);
        if (!held) {
          await tx.slot.updateMany({ where: { id: slotId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 } } });
          await tx.waitlistEntry.updateMany({ where: { id: o.entryId }, data: { status: "ACTIVE" } });
          continue;
        }
        const offer = await tx.slotOffer.create({
          data: { waitlistId: o.entryId, farmerId: o.farmerId, centreId: centre.id, slotId, cropId, quantityKg: o.quantityKg, expiresAt },
        });
        created.push({ offerId: offer.id, farmerId: o.farmerId });
        await logAllocation(tx, {
          ...base,
          event: "OFFERED",
          waitlistId: o.entryId,
          offerId: offer.id,
          farmerCode: code.get(o.entryId),
          kg: o.quantityKg,
          reason: "fits",
          params: { remainingBeforeKg: remaining },
        });
      }
      if (created.length === 0) {
        await logAllocation(tx, { ...base, event: "NO_ELIGIBLE", kg: remaining, reason: "noEligible" });
      }
    },
    { timeout: 20_000, maxWait: 10_000 }
  );

  for (const c of created) await announceOffer(c.offerId);
  if (created.length > 0) {
    emitCentre(centre.id, "capacity-updated");
    emitCentre(centre.id, "waitlist-updated");
  }
  return { offered: created.length };
}

async function announceOffer(offerId: string): Promise<void> {
  try {
    const o = await prisma.slotOffer.findUnique({
      where: { id: offerId },
      include: { slot: { include: { centre: true } }, waitlist: { include: { crop: true, farmer: { include: { user: true } } } } },
    });
    if (!o) return;
    const when = `${o.slot.date.toLocaleDateString("en-IN")} ${o.slot.startTime}-${o.slot.endTime}`;
    const minutes = o.slot.centre.offerWindowMin;
    const message = `Good news! A ${o.waitlist.crop.name} slot is available for your ${o.quantityKg} kg at ${o.slot.centre.name}, ${when}. Accept within ${minutes} minutes.`;
    await notifyFarmer(o.farmerId, "slotOffer", message, { crop: o.waitlist.crop.name, kg: o.quantityKg, when, minutes, centre: o.slot.centre.name, offerId: o.id });
    void sendSms(o.waitlist.farmer.user.mobile, message);
    emitUser(o.waitlist.farmer.userId, "offers-updated");
  } catch (err) {
    console.error("announceOffer failed:", err);
  }
}

// Called by every place that frees capacity (cancel, no-show, approved
// emergency, smaller weight, capacity raised). Records the release, then
// offers the room to the waitlist. Never throws: a failure here must not
// undo the cancellation that triggered it.
export async function onCapacityReleased(p: {
  slotId: string;
  cropId: string | null;
  kg: number;
  trigger: string;
  actor?: Actor;
}): Promise<void> {
  try {
    if (!p.cropId) return;
    const slot = await prisma.slot.findUnique({ where: { id: p.slotId }, include: { centre: true } });
    const crop = await prisma.crop.findUnique({ where: { id: p.cropId } });
    if (!slot || !crop) return;
    await logAllocation(prisma, {
      centreId: slot.centreId,
      event: "RELEASED",
      slotId: p.slotId,
      cropId: p.cropId,
      cropName: crop.name,
      slotDate: slot.date,
      slotStart: slot.startTime,
      trigger: p.trigger,
      kg: p.kg,
      actor: p.actor ?? null,
    });
    await redistributeSlot(p.slotId, p.cropId, p.trigger, p.actor ?? null);
  } catch (err) {
    console.error("onCapacityReleased failed:", err);
  }
}

// ---------- Closing an offer (decline, expiry, withdrawal) ----------

export async function closeOffer(
  offerId: string,
  outcome: "EXPIRED" | "DECLINED" | "CANCELLED",
  opts: { actor?: Actor; entryAfter?: "WITHDRAWN"; redistribute?: boolean } = {}
): Promise<boolean> {
  const cfg = queueConfig();
  const result = await prisma.$transaction(async (tx) => {
    const offer = await tx.slotOffer.findUnique({ where: { id: offerId } });
    if (!offer) return null;
    const flipped = await tx.slotOffer.updateMany({
      where: { id: offerId, status: "PENDING" },
      data: { status: outcome, respondedAt: new Date() },
    });
    if (flipped.count === 0) return null; // someone else already closed or accepted it
    // Give the held room back, exactly once.
    const rel = await tx.slotOffer.updateMany({ where: { id: offerId, reservationHeld: true }, data: { reservationHeld: false } });
    if (rel.count === 1) {
      await releaseRaw(tx, offer.slotId, offer.cropId, offer.quantityKg);
      await tx.slot.updateMany({ where: { id: offer.slotId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 } } });
    }
    const entry = await tx.waitlistEntry.findUnique({ where: { id: offer.waitlistId }, include: { farmer: { select: { farmerCode: true, userId: true } } } });
    let entryStatus = "ACTIVE";
    if (entry) {
      if (opts.entryAfter === "WITHDRAWN") entryStatus = "WITHDRAWN";
      else if (outcome === "EXPIRED") entryStatus = entry.expiryCount + 1 >= cfg.maxMissedOffers ? "EXPIRED" : "ACTIVE";
      await tx.waitlistEntry.updateMany({
        where: { id: offer.waitlistId, status: "OFFERED" },
        data: {
          status: entryStatus as "ACTIVE" | "WITHDRAWN" | "EXPIRED",
          ...(outcome === "EXPIRED" ? { expiryCount: { increment: 1 } } : {}),
          ...(outcome === "DECLINED" ? { declineCount: { increment: 1 } } : {}),
        },
      });
    }
    return { offer, entry, entryStatus };
  });
  if (!result) return false;

  const { offer, entry, entryStatus } = result;
  const slot = await prisma.slot.findUnique({ where: { id: offer.slotId } });
  const crop = await prisma.crop.findUnique({ where: { id: offer.cropId } });
  await logAllocation(prisma, {
    centreId: offer.centreId,
    event: outcome === "EXPIRED" ? "EXPIRED" : outcome === "DECLINED" ? "DECLINED" : "WITHDRAWN",
    slotId: offer.slotId,
    cropId: offer.cropId,
    cropName: crop?.name ?? "",
    slotDate: slot?.date ?? null,
    slotStart: slot?.startTime ?? null,
    waitlistId: offer.waitlistId,
    offerId: offer.id,
    farmerCode: entry?.farmer.farmerCode ?? null,
    kg: offer.quantityKg,
    actor: opts.actor ?? null,
  });
  if (outcome === "EXPIRED") {
    await notifyFarmer(
      offer.farmerId,
      "slotOfferExpired",
      entryStatus === "EXPIRED"
        ? "Your slot offer expired and you have been removed from the waitlist after repeated missed offers."
        : "Your slot offer expired because it was not accepted in time. You stay on the waitlist.",
      { removed: entryStatus === "EXPIRED" ? 1 : 0 }
    );
  }
  if (entry) emitUser(entry.farmer.userId, "offers-updated");
  emitCentre(offer.centreId, "capacity-updated");
  emitCentre(offer.centreId, "waitlist-updated");
  if (opts.redistribute !== false) await redistributeSlot(offer.slotId, offer.cropId, outcome === "EXPIRED" ? "OFFER_EXPIRED" : outcome === "DECLINED" ? "OFFER_DECLINED" : "WITHDRAWN");
  return true;
}

// Closes every offer whose time is up. Called by the background job, and it
// is safe to call as often as you like.
export async function expireDueOffers(): Promise<number> {
  const due = await prisma.slotOffer.findMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
  });
  let n = 0;
  for (const o of due) if (await closeOffer(o.id, "EXPIRED")) n++;
  return n;
}

// ---------- Farmer actions ----------

async function farmerOf(userId: string) {
  const farmer = await prisma.farmer.findUnique({ where: { userId }, include: { user: true } });
  if (!farmer) throw new WaitlistError("NO_FARMER", "Farmer profile not found.", 404);
  return farmer;
}

export async function acceptOffer(userId: string, offerId: string) {
  const farmer = await farmerOf(userId);
  let expiredNow = false;
  try {
    const booking = await prisma.$transaction(
      async (tx) => {
        // Same farmer double-clicking waits here, then sees the offer already closed.
        await tx.$queryRaw`SELECT id FROM farmers WHERE id = ${farmer.id} FOR UPDATE`;
        const offer = await tx.slotOffer.findUnique({ where: { id: offerId }, include: { slot: true, waitlist: { include: { crop: true } } } });
        if (!offer || offer.farmerId !== farmer.id) throw new WaitlistError("NOT_FOUND", "Offer not found.", 404);

        const won = await tx.slotOffer.updateMany({
          where: { id: offerId, status: "PENDING", expiresAt: { gt: new Date() }, reservationHeld: true },
          data: { status: "ACCEPTED", respondedAt: new Date(), reservationHeld: false },
        });
        if (won.count === 0) {
          if (offer.status === "PENDING") {
            expiredNow = true;
            throw new WaitlistError("OFFER_EXPIRED", "This offer has expired.");
          }
          throw new WaitlistError("OFFER_CLOSED", "This offer is no longer available.");
        }
        // One active booking per day, as everywhere else.
        const same = await tx.booking.findFirst({ where: { farmerId: farmer.id, status: "BOOKED", slot: { date: offer.slot.date } } });
        if (same) throw new WaitlistError("DUPLICATE_BOOKING", "You already have an active booking on that date. Cancel it first, or decline this offer.");

        const tokenNumber = await nextTokenNumber(tx, offer.slot.centreId, offer.slot.date);
        const caseId = await nextCaseId(tx, offer.slot.date.getUTCFullYear());
        // The weight and farmer place were already held when the offer was made.
        const created = await tx.booking.create({
          data: {
            farmerId: farmer.id,
            slotId: offer.slotId,
            caseId,
            tokenNumber,
            crop: offer.waitlist.crop.name,
            cropId: offer.cropId,
            quantityKg: offer.quantityKg,
            capacityCounted: true,
            status: "BOOKED",
          },
        });
        await tx.queueEntry.create({ data: { bookingId: created.id, stage: "SLOT_BOOKED" } });
        await tx.slotOffer.update({ where: { id: offerId }, data: { bookingId: created.id } });
        await tx.waitlistEntry.update({ where: { id: offer.waitlistId }, data: { status: "FULFILLED", bookingId: created.id } });
        return { created, offer };
      },
      { timeout: 15_000 }
    );

    const { created, offer } = booking;
    const centre = await prisma.procurementCentre.findUnique({ where: { id: offer.slot.centreId } });
    await logAllocation(prisma, {
      centreId: offer.centreId,
      event: "ACCEPTED",
      slotId: offer.slotId,
      cropId: offer.cropId,
      cropName: offer.waitlist.crop.name,
      slotDate: offer.slot.date,
      slotStart: offer.slot.startTime,
      waitlistId: offer.waitlistId,
      offerId: offer.id,
      farmerCode: farmer.farmerCode,
      kg: offer.quantityKg,
    });
    await logAudit({ userId, role: "FARMER" }, "OFFER_ACCEPT", { bookingId: created.id, details: { token: created.tokenNumber, kg: offer.quantityKg } });
    await notifyFarmer(
      farmer.id,
      "slotOfferAccepted",
      `Slot confirmed. Token ${created.tokenNumber} at ${centre?.name}.`,
      { token: created.tokenNumber, centre: centre?.name ?? "" }
    );
    void sendSms(
      farmer.user.mobile,
      `Slot confirmed at ${centre?.name} on ${offer.slot.date.toLocaleDateString("en-IN")} ${offer.slot.startTime}-${offer.slot.endTime}. Your token: ${created.tokenNumber}.`
    );
    emitCentre(offer.centreId, "capacity-updated");
    emitCentre(offer.centreId, "waitlist-updated");
    emitUser(userId, "offers-updated");
    return {
      id: created.id,
      caseId: created.caseId,
      tokenNumber: created.tokenNumber,
      crop: created.crop,
      quantityKg: created.quantityKg,
      date: offer.slot.date,
      startTime: offer.slot.startTime,
      endTime: offer.slot.endTime,
      centreName: centre?.name,
    };
  } catch (err) {
    if (expiredNow) await closeOffer(offerId, "EXPIRED"); // free the room and offer it onward
    throw err;
  }
}

export async function declineOffer(userId: string, offerId: string): Promise<void> {
  const farmer = await farmerOf(userId);
  const offer = await prisma.slotOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.farmerId !== farmer.id) throw new WaitlistError("NOT_FOUND", "Offer not found.", 404);
  const closed = await closeOffer(offerId, "DECLINED");
  if (!closed) throw new WaitlistError("OFFER_CLOSED", "This offer is no longer available.");
  await logAudit({ userId, role: "FARMER" }, "OFFER_DECLINE", { details: { kg: offer.quantityKg } });
}

export interface JoinInput {
  centreId: string;
  cropId: string;
  quantityKg: number;
  date: string;
  windowStart?: string | null;
  windowEnd?: string | null;
}

export async function joinWaitlist(userId: string, input: JoinInput) {
  const cfg = queueConfig();
  const farmer = await farmerOf(userId);
  const crop = await prisma.crop.findUnique({ where: { id: input.cropId } });
  if (!crop || !crop.isActive) throw new WaitlistError("CROP_INVALID", "Please choose a crop that is available for booking.", 400);
  const weightProblem = checkWeight(input.quantityKg, crop);
  if (weightProblem) throw new WaitlistError(weightProblem.code, weightProblem.message, 400);
  const centre = await prisma.procurementCentre.findUnique({ where: { id: input.centreId } });
  if (!centre || !centre.isActive) throw new WaitlistError("CENTRE_INVALID", "This centre is not available.", 400);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new WaitlistError("DATE_INVALID", "Please choose a valid date.", 400);
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (date < today) throw new WaitlistError("DATE_PAST", "You can't join the waitlist for a past date.", 400);
  if (date.getTime() - today.getTime() > cfg.waitlistLookaheadDays * 86_400_000) {
    throw new WaitlistError("DATE_FAR", `You can join the waitlist up to ${cfg.waitlistLookaheadDays} days ahead.`, 400);
  }
  const ws = input.windowStart || null;
  const we = input.windowEnd || null;
  if ((ws && !HHMM.test(ws)) || (we && !HHMM.test(we)) || (ws && we && ws >= we)) {
    throw new WaitlistError("WINDOW_INVALID", "Choose a valid time range (start before end).", 400);
  }

  if (await prisma.booking.findFirst({ where: { farmerId: farmer.id, status: "BOOKED", slot: { date } } })) {
    throw new WaitlistError("ALREADY_BOOKED", "You already have an active booking on that date.");
  }
  const dup = await prisma.waitlistEntry.findFirst({
    where: { farmerId: farmer.id, centreId: centre.id, cropId: crop.id, preferredDate: date, status: { in: ["ACTIVE", "OFFERED"] } },
  });
  if (dup) throw new WaitlistError("DUPLICATE_WAITLIST", "You are already on the waitlist for this crop, centre and date.");
  const active = await prisma.waitlistEntry.count({ where: { farmerId: farmer.id, status: { in: ["ACTIVE", "OFFERED"] } } });
  if (active >= cfg.maxActiveWaitlistEntries) {
    throw new WaitlistError("WAITLIST_LIMIT", `You can be on at most ${cfg.maxActiveWaitlistEntries} waitlists at once. Withdraw one first.`);
  }

  // If a slot in the chosen time range already has room, booking directly is better.
  const inputs = await getCropSlotInputs(centre.id, crop, input.date);
  const fits = rankSlots(inputs, input.quantityKg).filter((s) => (s.rank === "RECOMMENDED" || s.rank === "ALTERNATIVE") && (!ws || s.startTime >= ws) && (!we || s.endTime <= we));
  if (fits.length > 0) {
    throw new WaitlistError("SLOT_AVAILABLE", "A slot with enough room is available right now. Please book it directly.");
  }

  const entry = await prisma.waitlistEntry.create({
    data: { farmerId: farmer.id, centreId: centre.id, cropId: crop.id, quantityKg: input.quantityKg, preferredDate: date, windowStart: ws, windowEnd: we },
  });
  await logAudit({ userId, role: "FARMER" }, "WAITLIST_JOIN", { details: { kg: input.quantityKg, name: centre.name } });
  await notifyFarmer(farmer.id, "waitlistJoined", `You are on the waitlist for ${crop.name} (${input.quantityKg} kg) at ${centre.name}.`, {
    crop: crop.name,
    kg: input.quantityKg,
    centre: centre.name,
  });
  emitCentre(centre.id, "waitlist-updated");
  return entry;
}

export async function withdrawEntry(userId: string, entryId: string): Promise<void> {
  const farmer = await farmerOf(userId);
  const entry = await prisma.waitlistEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.farmerId !== farmer.id) throw new WaitlistError("NOT_FOUND", "Waitlist entry not found.", 404);
  if (entry.status !== "ACTIVE" && entry.status !== "OFFERED") throw new WaitlistError("NOT_ACTIVE", "This waitlist entry is already closed.");

  // A pending offer is cancelled first (this frees its held room and offers it onward).
  const pending = await prisma.slotOffer.findFirst({ where: { waitlistId: entryId, status: "PENDING" } });
  if (pending) await closeOffer(pending.id, "CANCELLED", { entryAfter: "WITHDRAWN" });
  await prisma.waitlistEntry.updateMany({ where: { id: entryId, status: { in: ["ACTIVE", "OFFERED"] } }, data: { status: "WITHDRAWN" } });
  if (!pending) {
    await logAllocation(prisma, { centreId: entry.centreId, event: "WITHDRAWN", cropId: entry.cropId, waitlistId: entryId, farmerCode: farmer.farmerCode, kg: entry.quantityKg, reason: "farmerWithdrew" });
  }
  await logAudit({ userId, role: "FARMER" }, "WAITLIST_WITHDRAW", { details: { kg: entry.quantityKg } });
  emitCentre(entry.centreId, "waitlist-updated");
}

// ---------- Farmer view ----------

export async function farmerWaitlistView(userId: string) {
  const farmer = await farmerOf(userId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const entries = await prisma.waitlistEntry.findMany({
    where: { farmerId: farmer.id, OR: [{ status: { in: ["ACTIVE", "OFFERED"] } }, { updatedAt: { gte: since } }] },
    include: { crop: true, centre: true },
    orderBy: { createdAt: "desc" },
  });
  const offers = await prisma.slotOffer.findMany({
    where: { farmerId: farmer.id, OR: [{ status: "PENDING" }, { createdAt: { gte: since } }] },
    include: { slot: { include: { centre: true, capacities: true } }, waitlist: { include: { crop: true } } },
    orderBy: { createdAt: "desc" },
  });

  const out = [];
  for (const e of entries) {
    let position: number | null = null;
    if (e.status === "ACTIVE") {
      position =
        1 +
        (await prisma.waitlistEntry.count({
          where: { centreId: e.centreId, cropId: e.cropId, preferredDate: e.preferredDate, status: "ACTIVE", createdAt: { lt: e.createdAt } },
        }));
    }
    out.push({
      id: e.id,
      centreId: e.centreId,
      centreName: e.centre.name,
      cropName: e.crop.name,
      quantityKg: e.quantityKg,
      date: e.preferredDate,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      status: e.status,
      position,
      createdAt: e.createdAt,
      bookingId: e.bookingId,
    });
  }
  const now = Date.now();
  return {
    entries: out,
    offers: offers.map((o) => {
      const cap = o.slot.capacities.find((c) => c.cropId === o.cropId);
      return {
        id: o.id,
        waitlistId: o.waitlistId,
        status: o.status === "PENDING" && o.expiresAt.getTime() <= now ? "EXPIRED" : o.status,
        centreName: o.slot.centre.name,
        cropName: o.waitlist.crop.name,
        quantityKg: o.quantityKg,
        date: o.slot.date,
        startTime: o.slot.startTime,
        endTime: o.slot.endTime,
        // Room left in the slot for this crop after this offer's weight is held.
        remainingAfterKg: cap ? Math.max(0, cap.maxWeightKg - cap.bookedWeightKg) : null,
        expiresAt: o.expiresAt,
        createdAt: o.createdAt,
        bookingId: o.bookingId,
      };
    }),
    now: new Date().toISOString(),
  };
}

// ---------- Officer view and controls ----------

export async function officerOverview(centreId: string) {
  const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
  if (!centre) throw new WaitlistError("NOT_FOUND", "Centre not found.", 404);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.waitlistEntry.findMany({
    where: { centreId, status: { in: ["ACTIVE", "OFFERED"] }, preferredDate: { gte: today } },
    include: { crop: true, farmer: { select: { farmerCode: true, fullName: true } } },
    orderBy: [{ preferredDate: "asc" }, { createdAt: "asc" }],
  });

  // Why each ACTIVE entry is, or is not, eligible for room right now.
  const entries = [];
  const dates = [...new Set(rows.map((r) => r.preferredDate.getTime()))].map((t) => new Date(t));
  const slots = dates.length ? await prisma.slot.findMany({ where: { centreId, date: { in: dates } }, include: { capacities: true }, orderBy: { startTime: "asc" } }) : [];
  const matchEntries = rows.map(toMatchEntry);
  const baseCtx = await buildContext(prisma, matchEntries, slots.map((s) => s.id));
  const posCount = new Map<string, number>();
  let eligibleNow = 0;
  for (const r of rows) {
    const key = `${r.cropId}|${dstr(r.preferredDate)}`;
    let position: number | null = null;
    if (r.status === "ACTIVE") {
      position = (posCount.get(key) ?? 0) + 1;
      posCount.set(key, position);
    }
    let eligibleSlots: { startTime: string; endTime: string }[] = [];
    let whyNot: { reason: SkipReason; shortfallKg?: number } | null = null;
    if (r.status === "ACTIVE") {
      const me = toMatchEntry(r);
      const candidates = slots.filter((s) => dstr(s.date) === dstr(r.preferredDate));
      let best: { reason: SkipReason; shortfallKg?: number } | null = null;
      for (const s of candidates) {
        const cap = s.capacities.find((c) => c.cropId === r.cropId);
        if (!cap) continue;
        const ctx: MatchContext = { ...baseCtx, bookedDates: baseCtx.bookedDates, pendingOfferDates: new Map([...baseCtx.pendingOfferDates].map(([k, v]) => [k, new Set(v)])) };
        const d = evaluateEntry(
          me,
          { slotId: s.id, centreId, cropId: r.cropId, date: dstr(s.date), startTime: s.startTime, endTime: s.endTime, remainingKg: Math.max(0, cap.maxWeightKg - cap.bookedWeightKg), placesLeft: s.capacity - s.bookedCount, endMs: slotTimesMs(s.date, s.startTime, s.endTime).endMs },
          Math.max(0, cap.maxWeightKg - cap.bookedWeightKg),
          s.capacity - s.bookedCount,
          ctx
        );
        if (d.eligible) eligibleSlots.push({ startTime: s.startTime, endTime: s.endTime });
        else if (d.reason === "notFullFit" && (!best || best.reason !== "notFullFit" || (d.shortfallKg ?? 0) < (best.shortfallKg ?? Infinity))) best = { reason: d.reason, shortfallKg: d.shortfallKg };
        else if (!best && !["wrongDate", "wrongCrop", "wrongCentre", "notActive"].includes(d.reason)) best = { reason: d.reason };
      }
      if (eligibleSlots.length === 0) whyNot = best ?? { reason: "notFullFit" };
      else eligibleNow++;
    }
    entries.push({
      id: r.id,
      farmerCode: r.farmer.farmerCode,
      farmerName: r.farmer.fullName,
      cropName: r.crop.name,
      quantityKg: r.quantityKg,
      date: r.preferredDate,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      status: r.status,
      position,
      createdAt: r.createdAt,
      eligibleSlots,
      whyNot,
    });
  }

  const byCropMap = new Map<string, { cropName: string; waiting: number; totalKg: number }>();
  for (const r of rows) {
    if (r.status !== "ACTIVE") continue;
    const c = byCropMap.get(r.cropId) ?? { cropName: r.crop.name, waiting: 0, totalKg: 0 };
    c.waiting++;
    c.totalKg += r.quantityKg;
    byCropMap.set(r.cropId, c);
  }

  const [pending, recent, logToday, log] = await Promise.all([
    prisma.slotOffer.findMany({ where: { centreId, status: "PENDING" }, include: { slot: true, waitlist: { include: { crop: true, farmer: { select: { farmerCode: true, fullName: true } } } } }, orderBy: { expiresAt: "asc" } }),
    prisma.slotOffer.findMany({ where: { centreId, status: { not: "PENDING" }, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, include: { slot: true, waitlist: { include: { crop: true, farmer: { select: { farmerCode: true, fullName: true } } } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.allocationLog.findMany({ where: { centreId, createdAt: { gte: today } }, select: { event: true, kg: true } }),
    prisma.allocationLog.findMany({ where: { centreId }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const sum = (ev: string) => logToday.filter((l) => l.event === ev).reduce((a, l) => a + l.kg, 0);
  const cnt = (ev: string) => logToday.filter((l) => l.event === ev).length;
  const pendingKg = pending.reduce((a, o) => a + o.quantityKg, 0);
  const releasedKg = sum("RELEASED");
  const acceptedKg = sum("ACCEPTED");
  const mapOffer = (o: (typeof pending)[number]) => ({
    id: o.id,
    farmerCode: o.waitlist.farmer.farmerCode,
    farmerName: o.waitlist.farmer.fullName,
    cropName: o.waitlist.crop.name,
    quantityKg: o.quantityKg,
    date: o.slot.date,
    startTime: o.slot.startTime,
    endTime: o.slot.endTime,
    status: o.status,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
  });

  return {
    centre: {
      id: centre.id,
      name: centre.name,
      waitlistPaused: centre.waitlistPaused,
      waitlistPauseReason: centre.waitlistPauseReason,
      centrePaused: centre.isPaused,
      offerWindowMin: centre.offerWindowMin,
    },
    summary: {
      waitingFarmers: rows.filter((r) => r.status === "ACTIVE").length,
      eligibleNow,
      pendingOffers: pending.length,
      pendingKg,
      releasedKg,
      acceptedCount: cnt("ACCEPTED"),
      acceptedKg,
      expiredCount: cnt("EXPIRED"),
      declinedCount: cnt("DECLINED"),
      // Released room that was neither taken by an accepted offer nor is currently held.
      returnedToPublicKg: Math.max(0, releasedKg - acceptedKg - pendingKg),
    },
    byCrop: [...byCropMap.values()],
    entries,
    pendingOffers: pending.map(mapOffer),
    recentOffers: recent.map(mapOffer),
    log: log.map((l) => ({
      id: l.id,
      event: l.event,
      trigger: l.trigger,
      cropName: l.cropName,
      slotDate: l.slotDate,
      slotStart: l.slotStart,
      kg: l.kg,
      farmerCode: l.farmerCode,
      reason: l.reason,
      params: l.params,
      actorRole: l.actorRole,
      note: l.note,
      createdAt: l.createdAt,
    })),
    generatedAt: new Date().toISOString(),
  };
}

// Offers room again across the centre's waitlist. Used when staff press
// "Redistribute" and when an authorised officer resumes after a pause.
export async function sweepCentre(centreId: string, trigger: string, actor: Actor): Promise<{ offered: number; blocked: boolean }> {
  const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
  if (!centre) return { offered: 0, blocked: false };
  if (centre.waitlistPaused || centre.isPaused || !centre.isActive) return { offered: 0, blocked: true };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const waiting = await prisma.waitlistEntry.findMany({
    where: { centreId, status: "ACTIVE", preferredDate: { gte: today } },
    select: { cropId: true, preferredDate: true },
  });
  const seen = new Set<string>();
  let offered = 0;
  for (const w of waiting) {
    const key = `${w.cropId}|${w.preferredDate.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slots = await prisma.slot.findMany({ where: { centreId, date: w.preferredDate }, orderBy: { startTime: "asc" } });
    for (const s of slots) offered += (await redistributeSlot(s.id, w.cropId, trigger, actor)).offered;
  }
  return { offered, blocked: false };
}

export async function setWaitlistPaused(centreId: string, paused: boolean, reason: string | null, actor: { userId: string; role: string }) {
  await prisma.procurementCentre.update({ where: { id: centreId }, data: { waitlistPaused: paused, waitlistPauseReason: paused ? reason : null } });
  await logAllocation(prisma, { centreId, event: paused ? "PAUSE_ON" : "PAUSE_OFF", actor, note: reason ?? null });
  await logAudit(actor, paused ? "WAITLIST_PAUSE" : "WAITLIST_RESUME", { details: { reason: reason ?? "" } });
  emitCentre(centreId, "waitlist-updated");
  // Resuming is the authorised action that lets redistribution start again.
  if (!paused) await sweepCentre(centreId, "RESUMED", actor);
}

export async function manualRedistribute(centreId: string, actor: { userId: string; role: string }, reason: string) {
  const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
  if (!centre) throw new WaitlistError("NOT_FOUND", "Centre not found.", 404);
  if (centre.waitlistPaused || centre.isPaused || !centre.isActive) {
    throw new WaitlistError("PAUSED", "Redistribution is paused for this centre. Resume it first.");
  }
  await logAllocation(prisma, { centreId, event: "MANUAL", actor, note: reason });
  await logAudit(actor, "WAITLIST_REDISTRIBUTE", { details: { reason } });
  const r = await sweepCentre(centreId, "MANUAL", actor);
  emitCentre(centreId, "waitlist-updated");
  return r;
}

export async function setOfferWindow(centreId: string, minutes: number, actor: { userId: string; role: string }) {
  const cfg = queueConfig();
  if (!Number.isInteger(minutes) || minutes < cfg.minOfferWindowMin || minutes > cfg.maxOfferWindowMin) {
    throw new WaitlistError("WINDOW_INVALID", `Choose between ${cfg.minOfferWindowMin} and ${cfg.maxOfferWindowMin} minutes.`, 400);
  }
  await prisma.procurementCentre.update({ where: { id: centreId }, data: { offerWindowMin: minutes } });
  await logAudit(actor, "OFFER_WINDOW_UPDATE", { details: { minutes } });
}

