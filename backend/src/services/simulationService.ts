// Everything an admin's "Simulation Controls" panel needs, kept in one
// place, deliberately separate from the real operator/farmer flows.
//
// Safety rule threaded through every function here: any booking this
// module creates belongs to a farmer whose Farmer ID starts with
// "SIM-". Every "act on the next farmer" action below ONLY ever looks
// at SIM- bookings — so clicking a demo button can never move, skip,
// or otherwise touch a real farmer's real booking. The one exception,
// clearly called out, is "Call Next Farmer": it advances the same
// shared current-token counter a real operator uses, since that's the
// whole point of demoing the live queue — the UI carries an explicit
// warning about this.

import { nextCaseId } from "../utils/caseId";
import { nextTokenNumber } from "../utils/tokenNumber";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { hashPassword } from "../utils/password";
import { getOrCreateSlotsForDate } from "./slotService";
import { getOrCreateProcurement } from "./procurementService";
import { getPricePerKg } from "../config/prices";
import { formatBillReference } from "../utils/billReference";
import { logAudit } from "./auditService";
import { notifyFarmer } from "./notificationService";

const SIM_PREFIX = "SIM-";
const DEMO_NAMES = [
  "Ramesh Kumar", "Suresh Yadav", "Geeta Devi", "Anita Sharma", "Manoj Singh",
  "Pooja Verma", "Rajesh Chauhan", "Sunita Rani", "Vikas Malik", "Kavita Kumari",
  "Deepak Rathi", "Sanjay Tomar", "Neha Gupta", "Ajay Chaudhary", "Rekha Devi",
  "Naresh Kumar", "Sonia Rani", "Vinod Kumar", "Meena Kumari", "Ashok Saini",
];
const DEMO_CROPS = ["Wheat", "Paddy", "Maize", "Mustard", "Sugarcane"];

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function randomUniqueMobile(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = "9" + Math.floor(100000000 + Math.random() * 900000000).toString();
    const exists = await prisma.user.findUnique({ where: { mobile: candidate } });
    if (!exists) return candidate;
  }
  // Astronomically unlikely to ever reach this, but keep it total.
  return "9" + Date.now().toString().slice(-9);
}

// One shared password hash for every simulated farmer — these accounts
// are throwaway demo data, not a real security boundary, and hashing
// bcrypt fresh 20 times in a loop would needlessly slow the button down.
let cachedSimPasswordHash: string | null = null;
async function getSimPasswordHash(): Promise<string> {
  if (!cachedSimPasswordHash) cachedSimPasswordHash = await hashPassword("simulated123");
  return cachedSimPasswordHash;
}

export interface AddFarmersResult {
  requested: number;
  added: number;
  skippedNoSlot: number;
}

// Creates `count` fake farmers with real bookings at `centreId` for
// today, filling whichever slots still have room, in order.
export async function addSimulatedFarmers(centreId: string, count: number): Promise<AddFarmersResult> {
  const today = startOfToday();
  const passwordHash = await getSimPasswordHash();
  const simCountSoFar = await prisma.farmer.count({ where: { farmerCode: { startsWith: SIM_PREFIX } } });

  let added = 0;
  let skippedNoSlot = 0;

  for (let i = 0; i < count; i++) {
    const slots = await getOrCreateSlotsForDate(centreId, today.toISOString().slice(0, 10));
    const openSlot = slots.find((s) => s.bookedCount < s.capacity);
    if (!openSlot) {
      skippedNoSlot++;
      continue;
    }

    const farmerCode = `${SIM_PREFIX}${today.getFullYear()}-${String(simCountSoFar + added + 1).padStart(4, "0")}`;
    const mobile = await randomUniqueMobile();

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          mobile,
          passwordHash,
          role: "FARMER",
          farmer: {
            create: {
              fullName: randomFrom(DEMO_NAMES),
              address: "Demo address",
              district: "Demo District",
              state: "Demo State",
              farmerCode,
            },
          },
        },
        include: { farmer: true },
      });

      await tx.slot.update({ where: { id: openSlot.id }, data: { bookedCount: { increment: 1 } } });

      // Token numbers are never reused (see utils/tokenNumber.ts).
      const tokenNumber = await nextTokenNumber(tx, centreId, today);

      const caseId = await nextCaseId(tx, today.getUTCFullYear());
      const booking = await tx.booking.create({
        data: {
          farmerId: user.farmer!.id,
          slotId: openSlot.id,
          caseId,
          tokenNumber,
          crop: randomFrom(DEMO_CROPS),
          quantityKg: Math.round((200 + Math.random() * 800) * 10) / 10,
          status: "BOOKED",
        },
      });

      await tx.queueEntry.create({ data: { bookingId: booking.id, stage: "SLOT_BOOKED" } });
    });

    // Reflect the new count locally so the next loop iteration picks a
    // (possibly now-full) slot correctly without re-reading from the DB.
    openSlot.bookedCount += 1;
    added++;
  }

  return { requested: count, added, skippedNoSlot };
}

// The earliest (lowest token) SIM- booking at a centre that hasn't
// reached its final stage yet.
async function findNextSimBookingToAdvance(centreId: string) {
  return prisma.booking.findFirst({
    where: {
      status: "BOOKED",
      slot: { centreId, date: startOfToday() },
      farmer: { farmerCode: { startsWith: SIM_PREFIX } },
      queueEntry: { stage: { not: "COMPLETED" } },
    },
    include: { queueEntry: true, slot: true },
    orderBy: { tokenNumber: "asc" },
  });
}

export interface StageAdvanceResult {
  advanced: boolean;
  bookingId?: string;
  tokenNumber?: number;
  fromStage?: string;
  toStage?: string;
}

// Moves the earliest waiting SIM- booking at `centreId` exactly one
// step forward, whatever step is next for it — mirrors the same
// database changes, audit entries, notifications, and live broadcasts
// the real operator actions make (see operatorController.ts), just
// centre-agnostic and automatic instead of driven by a real form.
export async function advanceNextSimulatedStage(
  centreId: string,
  actor: { userId: string; role: string }
): Promise<StageAdvanceResult> {
  const booking = await findNextSimBookingToAdvance(centreId);
  if (!booking || !booking.queueEntry) return { advanced: false };

  const fromStage = booking.queueEntry.stage;
  let toStage = fromStage;

  if (fromStage === "SLOT_BOOKED") {
    toStage = "ARRIVED";
    await prisma.queueEntry.update({ where: { id: booking.queueEntry.id }, data: { stage: toStage } });
    await notifyFarmer(booking.farmerId, "arrived", "You have been marked as arrived at the centre.");
  } else if (fromStage === "ARRIVED") {
    toStage = "VERIFIED";
    await prisma.queueEntry.update({ where: { id: booking.queueEntry.id }, data: { stage: toStage } });
    await notifyFarmer(booking.farmerId, "verified", "Your details have been verified.");
  } else if (fromStage === "VERIFIED") {
    toStage = "QUALITY_CHECKED";
    const procurement = await getOrCreateProcurement(booking.id);
    await prisma.qualityCheck.create({
      data: {
        procurementId: procurement.id,
        moisturePercent: Math.round((8 + Math.random() * 6) * 10) / 10,
        foreignMatter: Math.round(Math.random() * 3 * 10) / 10,
        qualityGrade: "A",
        remarks: "Simulated",
        result: "ACCEPTED",
      },
    });
    await prisma.procurement.update({ where: { id: procurement.id }, data: { status: toStage } });
    await prisma.queueEntry.update({ where: { id: booking.queueEntry.id }, data: { stage: toStage } });
    await notifyFarmer(booking.farmerId, "qualityAccepted", "Quality check complete: your produce was accepted.");
  } else if (fromStage === "QUALITY_CHECKED") {
    toStage = "WEIGHED";
    const procurement = await getOrCreateProcurement(booking.id);
    const grossWeightKg = booking.quantityKg + 20;
    const netWeightKg = booking.quantityKg;
    await prisma.weighment.create({
      data: { procurementId: procurement.id, grossWeightKg, netWeightKg, remarks: "Simulated" },
    });
    await prisma.procurement.update({ where: { id: procurement.id }, data: { status: toStage } });
    await prisma.queueEntry.update({ where: { id: booking.queueEntry.id }, data: { stage: toStage } });
    await notifyFarmer(booking.farmerId, "weighed", `Weighing complete. Net weight: ${netWeightKg} kg.`, { kg: netWeightKg });
  } else if (fromStage === "WEIGHED") {
    toStage = "COMPLETED";
    const procurement = await getOrCreateProcurement(booking.id);
    const weighment = await prisma.weighment.findUnique({ where: { procurementId: procurement.id } });
    const pricePerKg = getPricePerKg(procurement.crop);
    const totalAmount = Math.round((weighment?.netWeightKg ?? 0) * pricePerKg * 100) / 100;
    const updatedProcurement = await prisma.procurement.update({
      where: { id: procurement.id },
      data: { pricePerKg, totalAmount, status: toStage, operatorUserId: actor.userId },
    });
    await prisma.queueEntry.update({ where: { id: booking.queueEntry.id }, data: { stage: toStage } });
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });
    await prisma.payment.create({ data: { procurementId: procurement.id, amount: totalAmount, status: "PENDING" } });
    const billReference = formatBillReference(updatedProcurement.id, updatedProcurement.createdAt);
    await notifyFarmer(
      booking.farmerId,
      "completed",
      `Procurement completed. Amount: ₹${totalAmount}. Bill ${billReference}.`,
      { amount: totalAmount, bill: billReference }
    );
  } else {
    return { advanced: false };
  }

  await logAudit(actor, "SIMULATED_STAGE_ADVANCE", {
    bookingId: booking.id,
    details: { token: booking.tokenNumber, fromStage, toStage },
  });

  getIO().to(`centre:${centreId}`).emit("stage-updated", { centreId, bookingId: booking.id, stage: toStage });

  return { advanced: true, bookingId: booking.id, tokenNumber: booking.tokenNumber, fromStage, toStage };
}

export interface PaymentAdvanceResult {
  advanced: boolean;
  bookingId?: string;
  tokenNumber?: number;
  toStatus?: string;
}

// Moves the earliest completed-but-not-yet-credited SIM- payment
// forward exactly one step, same transition order the real payment
// actions enforce.
export async function advanceNextSimulatedPayment(
  centreId: string,
  actor: { userId: string; role: string }
): Promise<PaymentAdvanceResult> {
  const procurement = await prisma.procurement.findFirst({
    where: {
      centreId,
      status: "COMPLETED",
      farmer: { farmerCode: { startsWith: SIM_PREFIX } },
      payment: { status: { not: "CREDITED" } },
    },
    include: { payment: true, booking: true },
    orderBy: { booking: { tokenNumber: "asc" } },
  });
  if (!procurement?.payment) return { advanced: false };

  const order: Record<string, "INITIATED" | "PROCESSING" | "CREDITED"> = {
    PENDING: "INITIATED",
    INITIATED: "PROCESSING",
    PROCESSING: "CREDITED",
  };
  const nextStatus = order[procurement.payment.status];
  if (!nextStatus) return { advanced: false };

  const updated = await prisma.payment.update({ where: { id: procurement.payment.id }, data: { status: nextStatus } });

  const notifText = {
    INITIATED: "Your payment has been initiated.",
    PROCESSING: "Your payment is being processed.",
    CREDITED: `Your payment of ₹${updated.amount} has been credited.`,
  }[nextStatus];
  const notifType = {
    INITIATED: "paymentInitiated",
    PROCESSING: "paymentProcessing",
    CREDITED: "paymentCredited",
  }[nextStatus] as "paymentInitiated" | "paymentProcessing" | "paymentCredited";

  await notifyFarmer(procurement.farmerId, notifType, notifText, { amount: updated.amount });
  await logAudit(actor, "SIMULATED_PAYMENT_ADVANCE", {
    bookingId: procurement.bookingId,
    details: { token: procurement.booking.tokenNumber, toStatus: nextStatus },
  });
  getIO()
    .to(`centre:${centreId}`)
    .emit("payment-updated", { centreId, bookingId: procurement.bookingId, paymentStatus: nextStatus });

  return { advanced: true, bookingId: procurement.bookingId, tokenNumber: procurement.booking.tokenNumber, toStatus: nextStatus };
}

export interface ResetResult {
  farmersRemoved: number;
}

// Deletes every trace of simulated data — and ONLY simulated data
// (every query below is scoped to farmerCode starting with "SIM-").
// Real farmers, real bookings, real everything are never touched.
// Also gives back the slot capacity that simulated bookings were
// occupying, so real farmers see accurate availability afterward.
export async function resetSimulation(): Promise<ResetResult> {
  const simFarmers = await prisma.farmer.findMany({
    where: { farmerCode: { startsWith: SIM_PREFIX } },
    include: { bookings: { include: { slot: true, procurement: true, queueEntry: true } } },
  });

  for (const farmer of simFarmers) {
    for (const booking of farmer.bookings) {
      if (booking.procurement) {
        await prisma.qualityCheck.deleteMany({ where: { procurementId: booking.procurement.id } });
        await prisma.weighment.deleteMany({ where: { procurementId: booking.procurement.id } });
        await prisma.payment.deleteMany({ where: { procurementId: booking.procurement.id } });
        await prisma.procurement.delete({ where: { id: booking.procurement.id } });
      }
      if (booking.queueEntry) {
        await prisma.queueEntry.delete({ where: { id: booking.queueEntry.id } });
      }
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.slot.update({
        where: { id: booking.slot.id },
        data: { bookedCount: { decrement: 1 } },
      });
    }
    await prisma.notification.deleteMany({ where: { farmerId: farmer.id } });
    await prisma.farmer.delete({ where: { id: farmer.id } });
    await prisma.user.delete({ where: { id: farmer.userId } });
  }

  return { farmersRemoved: simFarmers.length };
}
