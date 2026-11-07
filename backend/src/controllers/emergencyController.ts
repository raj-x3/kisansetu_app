// Emergency cancellation and smart rescheduling.
//
// Farmer side:  send a request (with optional evidence), follow its status,
//               add evidence, ask for a second look, and pick a new slot.
// Officer side: see requests at their own centre, read the weather check and
//               the evidence, approve / reject / flag / ask for more proof.
//
// Rules this file enforces on the SERVER (the screens only help):
//   - a farmer sees only their own requests; officers only their own centre's;
//   - one request per booking, and only while the booking is still "Slot booked";
//   - weight is released ONLY when an officer approves, in the same database
//     transaction that cancels the booking, so numbers never disagree;
//   - rescheduling reserves the whole weight atomically, never half of it.
// Side effects (notifications, SMS, audit, live updates) never block the action.

import { onCapacityReleased } from "../services/waitlistService";
import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";
import { sendSms } from "../services/smsService";
import { nextCaseId } from "../utils/caseId";
import { nextTokenNumber } from "../utils/tokenNumber";
import { emergencyConfig, MAX_EVIDENCE_AT_SUBMIT, MAX_EVIDENCE_PER_REQUEST, MAX_EVIDENCE_TOTAL_BYTES_PER_CALL } from "../config/emergency";
import { MAX_DOCUMENT_BYTES, detectMimeType, cleanFileName } from "../services/documentService";
import {
  CapacityError,
  ensureCapacityRows,
  getCropSlotInputs,
  releaseBookingCapacity,
  reserveWeight,
} from "../services/capacityService";
import { rankSlots } from "../utils/slotRecommend";
import {
  OPEN_STATUSES,
  emitCapacityChanged,
  emitEmergencyUpdated,
  nextRequestNo,
  roundCoord,
  runVerification,
  slotTimesMs,
} from "../services/emergencyService";
import { getIO } from "../socket";

const CATEGORIES = ["HEAVY_RAINFALL", "FLOODING", "SEVERE_WEATHER", "ROAD_BLOCKAGE", "OTHER"] as const;
const STATUSES = ["SUBMITTED", "UNDER_VERIFICATION", "AWAITING_REVIEW", "APPROVED", "REJECTED", "RESCHEDULING_AVAILABLE", "RESCHEDULED"] as const;
const HOUR = 3_600_000;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function sendError(res: Response, err: unknown, fallback: string, where: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof CapacityError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`${where} failed:`, err);
  return res.status(500).json({ error: fallback });
}

// ---------- what each side is allowed to see ----------

const viewInclude = {
  centre: { select: { name: true } },
  booking: { select: { caseId: true, tokenNumber: true } },
  evidence: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.EmergencyRequestInclude;
type Loaded = Prisma.EmergencyRequestGetPayload<{ include: typeof viewInclude }>;

// The farmer's copy. It deliberately leaves out the officers' private notes:
// flags, support score and the reasons behind them.
function farmerView(r: Loaded) {
  return {
    id: r.id,
    requestNo: r.requestNo,
    bookingId: r.bookingId,
    caseId: r.booking.caseId,
    centreName: r.centre.name,
    crop: r.crop,
    quantityKg: r.quantityKg,
    slotDate: r.slotDate,
    slotStart: r.slotStart,
    slotEnd: r.slotEnd,
    category: r.category,
    description: r.description,
    incidentAt: r.incidentAt,
    status: r.status,
    verificationResult: r.outcome,
    decision: r.decision,
    officerRemarks: r.decisionRemarks,
    decidedAt: r.decidedAt,
    manualReviewRequested: r.manualReviewRequested,
    newBookingId: r.newBookingId,
    evidence: r.evidence,
    createdAt: r.createdAt,
    canAddEvidence: (OPEN_STATUSES as readonly string[]).includes(r.status) && r.evidence.length < MAX_EVIDENCE_PER_REQUEST,
    canRequestReview: r.status === "REJECTED" && !r.manualReviewRequested,
    canReschedule: r.status === "RESCHEDULING_AVAILABLE",
  };
}

async function myFarmer(userId: string) {
  return prisma.farmer.findUnique({ where: { userId }, include: { user: { select: { mobile: true } } } });
}

async function loadOwn(req: Request) {
  const r = await prisma.emergencyRequest.findFirst({
    where: { id: req.params.id, farmer: { userId: req.user!.userId } },
    include: viewInclude,
  });
  if (!r) throw new HttpError(404, "Request not found.");
  return r;
}

// Staff: an admin sees every centre; everyone else only their own.
async function staffScope(req: Request): Promise<{ all: boolean; centreId: string | null; name: string }> {
  if (req.user!.role === "ADMIN") return { all: true, centreId: null, name: "Administrator" };
  const op = await prisma.operator.findUnique({ where: { userId: req.user!.userId } });
  return { all: false, centreId: op?.centreId ?? null, name: op?.fullName ?? req.user!.role };
}

async function loadForStaff(req: Request) {
  const scope = await staffScope(req);
  const r = await prisma.emergencyRequest.findUnique({ where: { id: req.params.id }, include: viewInclude });
  // A different centre's request looks exactly like "not found".
  if (!r || (!scope.all && r.centreId !== scope.centreId)) throw new HttpError(404, "Request not found.");
  return { r, scope };
}

// ---------- evidence files ----------

function readEvidence(items: { fileName: string; dataBase64: string }[]) {
  let total = 0;
  const rows: { fileName: string; mimeType: string; sizeBytes: number; data: Buffer }[] = [];
  for (const it of items) {
    const data = Buffer.from(it.dataBase64, "base64");
    if (data.length === 0) throw new HttpError(400, "One of the files is empty.", "FILE_EMPTY");
    if (data.length > MAX_DOCUMENT_BYTES) throw new HttpError(400, "A file is larger than 2 MB. Please choose a smaller file.", "FILE_TOO_BIG");
    // The type is read from the file's real bytes, never from its name.
    const mime = detectMimeType(data);
    if (!mime) throw new HttpError(400, "Only photos (JPG, PNG) and PDF files are accepted.", "FILE_TYPE");
    total += data.length;
    rows.push({ fileName: cleanFileName(it.fileName), mimeType: mime, sizeBytes: data.length, data });
  }
  if (total > MAX_EVIDENCE_TOTAL_BYTES_PER_CALL) {
    throw new HttpError(400, "The files together are too large. Send fewer or smaller files.", "FILES_TOO_BIG");
  }
  return rows;
}

const evidenceItem = z.object({ fileName: z.string().min(1).max(200), dataBase64: z.string().min(1) });

// ---------- farmer: send a request ----------

const createSchema = z
  .object({
    bookingId: z.string().uuid("Choose the booking."),
    category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Choose what happened." }) }),
    description: z.string().trim().min(10, "Please explain in at least a few words (10 letters).").max(500, "Please keep it under 500 letters."),
    incidentAt: z.string().datetime({ offset: true, message: "Enter when it happened." }),
    affectedLat: z.number().min(-90).max(90).optional(),
    affectedLng: z.number().min(-180).max(180).optional(),
    evidence: z.array(evidenceItem).max(MAX_EVIDENCE_AT_SUBMIT, `You can attach up to ${MAX_EVIDENCE_AT_SUBMIT} files now. Add more later.`).optional(),
  })
  .refine((v) => (v.affectedLat === undefined) === (v.affectedLng === undefined), { message: "Location is incomplete." });

export async function createEmergency(req: Request, res: Response) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.errors[0].message, "INVALID");
    const body = parsed.data;
    const cfg = emergencyConfig();

    const farmer = await myFarmer(req.user!.userId);
    if (!farmer) throw new HttpError(404, "Farmer profile not found.");

    const booking = await prisma.booking.findUnique({
      where: { id: body.bookingId },
      include: { slot: { include: { centre: true } }, queueEntry: true, emergencyRequest: true },
    });
    // Someone else's booking looks exactly like a booking that does not exist.
    if (!booking || booking.farmerId !== farmer.id) throw new HttpError(404, "Booking not found.");
    if (booking.emergencyRequest) {
      throw new HttpError(409, "You have already sent an emergency request for this booking.", "EMERGENCY_EXISTS");
    }
    if (booking.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active, so it can't be cancelled.", "NOT_ACTIVE");
    if ((booking.queueEntry?.stage ?? "SLOT_BOOKED") !== "SLOT_BOOKED") {
      throw new HttpError(409, "You have already arrived at the centre, so this booking can't be cancelled.", "ALREADY_ARRIVED");
    }

    const times = slotTimesMs(booking.slot.date, booking.slot.startTime, booking.slot.endTime);
    const now = Date.now();
    if (now > times.endMs + cfg.lateWindowHours * HOUR) {
      throw new HttpError(409, `This request is too late. Emergency requests are accepted up to ${cfg.lateWindowHours} hours after the slot. Please contact the centre.`, "TOO_LATE");
    }
    const incidentMs = Date.parse(body.incidentAt);
    if (incidentMs < times.startMs - cfg.earlyWindowHours * HOUR || incidentMs > times.endMs + cfg.lateWindowHours * HOUR) {
      throw new HttpError(400, "The time of the emergency must be close to your booking time.", "INCIDENT_TIME");
    }

    const files = readEvidence(body.evidence ?? []);

    const created = await prisma.$transaction(async (tx) => {
      // Lock the farmer's row so a double-tap waits here and then sees the first request.
      await tx.$queryRaw`SELECT id FROM farmers WHERE id = ${farmer.id} FOR UPDATE`;
      const fresh = await tx.booking.findUnique({
        where: { id: booking.id },
        include: { queueEntry: true, emergencyRequest: { select: { id: true } } },
      });
      if (!fresh || fresh.status !== "BOOKED" || (fresh.queueEntry?.stage ?? "SLOT_BOOKED") !== "SLOT_BOOKED") {
        throw new HttpError(409, "This booking is no longer active, so it can't be cancelled.", "NOT_ACTIVE");
      }
      if (fresh.emergencyRequest) throw new HttpError(409, "You have already sent an emergency request for this booking.", "EMERGENCY_EXISTS");

      const requestNo = await nextRequestNo(tx, new Date().getUTCFullYear());
      return tx.emergencyRequest.create({
        data: {
          requestNo,
          bookingId: booking.id,
          farmerId: farmer.id,
          centreId: booking.slot.centreId,
          crop: booking.crop,
          quantityKg: booking.quantityKg,
          slotId: booking.slotId,
          slotDate: booking.slot.date,
          slotStart: booking.slot.startTime,
          slotEnd: booking.slot.endTime,
          category: body.category,
          description: body.description,
          incidentAt: new Date(incidentMs),
          affectedLat: body.affectedLat !== undefined ? roundCoord(body.affectedLat) : null,
          affectedLng: body.affectedLng !== undefined ? roundCoord(body.affectedLng) : null,
          evidence: { create: files },
        },
        include: viewInclude,
      });
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "EMERGENCY_SUBMIT", {
      bookingId: booking.id,
      details: { token: booking.tokenNumber },
    });
    await notifyFarmer(
      farmer.id,
      "emergencySubmitted",
      `Your emergency request ${created.requestNo} was received. We are checking it.`,
      { requestNo: created.requestNo }
    );
    sendSms(farmer.user.mobile, `Emergency request ${created.requestNo} received for your booking at ${booking.slot.centre.name}. An officer will review it.`);
    emitEmergencyUpdated({ id: created.id, status: created.status, centreId: created.centreId }, req.user!.userId);

    // The weather check runs in the background; the farmer's screen updates by itself.
    void runVerification(created.id);

    return res.status(201).json(farmerView(created));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "This request was already sent. Open it from your dashboard.", code: "EMERGENCY_EXISTS" });
    }
    return sendError(res, err, "Could not send your request. Please try again.", "createEmergency");
  }
}

// ---------- farmer: look at requests ----------

export async function listMine(req: Request, res: Response) {
  try {
    const rows = await prisma.emergencyRequest.findMany({
      where: { farmer: { userId: req.user!.userId } },
      include: viewInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.set("Cache-Control", "no-store");
    return res.json(rows.map(farmerView));
  } catch (err) {
    return sendError(res, err, "Could not load your requests.", "listMine");
  }
}

// GET /farmer/:farmerId — "me" or the farmer's own id. Any other id looks like nothing exists.
export async function listForFarmerId(req: Request, res: Response) {
  try {
    const farmer = await myFarmer(req.user!.userId);
    if (!farmer || (req.params.farmerId !== "me" && req.params.farmerId !== farmer.id)) {
      throw new HttpError(404, "Not found.");
    }
    return listMine(req, res);
  } catch (err) {
    return sendError(res, err, "Could not load your requests.", "listForFarmerId");
  }
}

export async function getOwn(req: Request, res: Response) {
  try {
    const r = await loadOwn(req);
    res.set("Cache-Control", "no-store");
    return res.json(farmerView(r));
  } catch (err) {
    return sendError(res, err, "Could not load this request.", "getOwn");
  }
}

export async function addEvidence(req: Request, res: Response) {
  try {
    const parsed = z.object({ evidence: z.array(evidenceItem).min(1).max(3) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Choose a file to add.");
    const r = await loadOwn(req);
    if (!(OPEN_STATUSES as readonly string[]).includes(r.status)) {
      throw new HttpError(409, "This request is already decided, so files can't be added.", "CLOSED");
    }
    if (r.evidence.length + parsed.data.evidence.length > MAX_EVIDENCE_PER_REQUEST) {
      throw new HttpError(409, `A request can have at most ${MAX_EVIDENCE_PER_REQUEST} files.`, "TOO_MANY");
    }
    const files = readEvidence(parsed.data.evidence);
    await prisma.emergencyEvidence.createMany({ data: files.map((f) => ({ ...f, requestId: r.id })) });
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "EMERGENCY_EVIDENCE_ADD", { bookingId: r.bookingId });
    const fresh = await loadOwn(req);
    emitEmergencyUpdated({ id: r.id, status: r.status, centreId: r.centreId }, req.user!.userId);
    return res.json(farmerView(fresh));
  } catch (err) {
    return sendError(res, err, "Could not add the file. Please try again.", "addEvidence");
  }
}

// One evidence file: the owner farmer, or staff who may review at that centre.
export async function getEvidenceFile(req: Request, res: Response) {
  try {
    const file = await prisma.emergencyEvidence.findFirst({
      where: { id: req.params.evidenceId, requestId: req.params.id },
      include: { request: { select: { centreId: true, farmer: { select: { userId: true } } } } },
    });
    if (!file) throw new HttpError(404, "File not found.");
    if (req.user!.role === "FARMER") {
      if (file.request.farmer.userId !== req.user!.userId) throw new HttpError(404, "File not found.");
    } else {
      const scope = await staffScope(req);
      if (!scope.all && scope.centreId !== file.request.centreId) throw new HttpError(404, "File not found.");
    }
    res.set({
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${cleanFileName(file.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return res.send(Buffer.from(file.data));
  } catch (err) {
    return sendError(res, err, "Could not open the file.", "getEvidenceFile");
  }
}

// A rejected farmer may ask for one more look.
export async function requestManualReview(req: Request, res: Response) {
  try {
    const parsed = z.object({ note: z.string().trim().max(300).optional() }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Please keep your note under 300 letters.");
    const r = await loadOwn(req);
    const changed = await prisma.emergencyRequest.updateMany({
      where: { id: r.id, status: "REJECTED", manualReviewRequested: false },
      data: {
        status: "AWAITING_REVIEW",
        manualReviewRequested: true,
        farmerReviewNote: parsed.data.note || null,
        decision: null,
        decisionRemarks: null,
        decidedAt: null,
        decidedByUserId: null,
      },
    });
    if (changed.count === 0) throw new HttpError(409, "A second review was already asked for, or this request can't be reviewed again.", "NOT_ALLOWED");
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "EMERGENCY_REVIEW_REQUEST", { bookingId: r.bookingId });
    await notifyFarmer(r.farmerId, "emergencyReviewRequested", `Your request ${r.requestNo} was sent for another review.`, { requestNo: r.requestNo });
    emitEmergencyUpdated({ id: r.id, status: "AWAITING_REVIEW", centreId: r.centreId }, req.user!.userId);
    return res.json(farmerView(await loadOwn(req)));
  } catch (err) {
    return sendError(res, err, "Could not send your request for review.", "requestManualReview");
  }
}

// ---------- farmer: smart rescheduling ----------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

export async function getRescheduleOptions(req: Request, res: Response) {
  try {
    const cfg = emergencyConfig();
    const r = await loadOwn(req);
    if (r.status !== "RESCHEDULING_AVAILABLE") throw new HttpError(409, "Rescheduling is not open for this request.", "NOT_AVAILABLE");
    const original = await prisma.booking.findUnique({ where: { id: r.bookingId }, select: { cropId: true } });
    if (!original?.cropId) {
      throw new HttpError(409, "This old booking has no crop link. Please book a new slot from \"Book a slot\".", "NO_CROP");
    }
    const crop = await prisma.crop.findUnique({ where: { id: original.cropId } });
    if (!crop || !crop.isActive) throw new HttpError(409, "This crop is not open for booking right now.", "CROP_CLOSED");
    const weight = Math.round(r.quantityKg);

    // Days on which this farmer already holds a booking can't be used (one booking per day).
    const busy = await prisma.booking.findMany({
      where: { farmerId: r.farmerId, status: "BOOKED" },
      select: { slot: { select: { date: true } } },
    });
    const busyDays = new Set(busy.map((b) => ymd(b.slot.date)));

    const today = ymd(new Date());
    const options: Array<{
      slotId: string; date: string; startTime: string; endTime: string;
      remainingKg: number; utilizationPct: number; afterBookingKg: number; recommended: boolean;
    }> = [];
    for (let i = 0; i <= cfg.rescheduleLookaheadDays && options.length < cfg.rescheduleMaxOptions; i++) {
      const date = addDays(today, i);
      if (busyDays.has(date)) continue;
      const inputs = await getCropSlotInputs(r.centreId, crop, date);
      for (const s of rankSlots(inputs, weight)) {
        if (s.rank !== "RECOMMENDED" && s.rank !== "ALTERNATIVE") continue; // whole weight must fit
        if (s.slotId === r.slotId) continue; // not the slot just given up
        if (slotTimesMs(new Date(`${date}T00:00:00.000Z`), s.startTime, s.endTime).startMs <= Date.now()) continue;
        options.push({
          slotId: s.slotId, date, startTime: s.startTime, endTime: s.endTime,
          remainingKg: s.remainingKg, utilizationPct: s.utilizationPct,
          afterBookingKg: s.afterBookingKg ?? 0, recommended: false,
        });
      }
    }
    options.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    const shown = options.slice(0, cfg.rescheduleMaxOptions);
    if (shown.length > 0) shown[0].recommended = true; // the earliest slot that fits everything

    res.set("Cache-Control", "no-store");
    return res.json({
      requestId: r.id,
      crop: r.crop,
      quantityKg: r.quantityKg,
      centreName: r.centre.name,
      searchedDays: cfg.rescheduleLookaheadDays + 1,
      options: shown,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return sendError(res, err, "Could not load new times. Please try again.", "getRescheduleOptions");
  }
}

export async function rescheduleAfterEmergency(req: Request, res: Response) {
  try {
    const parsed = z.object({ slotId: z.string().uuid("Please choose a new slot.") }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.errors[0].message);
    const r = await loadOwn(req);
    const farmer = await myFarmer(req.user!.userId);
    if (!farmer) throw new HttpError(404, "Farmer profile not found.");

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM farmers WHERE id = ${farmer.id} FOR UPDATE`;

      // The first call to get here wins; a double-tap finds the status already changed.
      const guard = await tx.emergencyRequest.updateMany({
        where: { id: r.id, status: "RESCHEDULING_AVAILABLE" },
        data: { status: "RESCHEDULED" },
      });
      if (guard.count === 0) throw new HttpError(409, "This request was already rescheduled.", "NOT_AVAILABLE");

      const old = await tx.booking.findUnique({ where: { id: r.bookingId } });
      if (!old?.cropId) throw new HttpError(409, "This old booking has no crop link. Please book a new slot normally.", "NO_CROP");
      const crop = await tx.crop.findUnique({ where: { id: old.cropId } });
      if (!crop || !crop.isActive) throw new HttpError(409, "This crop is not open for booking right now.", "CROP_CLOSED");

      const slot = await tx.slot.findUnique({ where: { id: parsed.data.slotId } });
      if (!slot) throw new CapacityError("SLOT_GONE", "This slot no longer exists.");
      if (slot.centreId !== r.centreId) throw new HttpError(400, "Choose a slot at the same centre.", "WRONG_CENTRE");
      if (slot.id === r.slotId) throw new HttpError(400, "Choose a different slot.", "SAME_SLOT");
      if (slotTimesMs(slot.date, slot.startTime, slot.endTime).startMs <= Date.now()) {
        throw new CapacityError("DATE_PAST", "That time has already passed. Please choose a later slot.");
      }
      const sameDay = await tx.booking.findFirst({ where: { farmerId: farmer.id, status: "BOOKED", slot: { date: slot.date } } });
      if (sameDay) throw new CapacityError("DUPLICATE_BOOKING", "You already have a booking on that date. Choose another date.");

      const place = await tx.slot.updateMany({
        where: { id: slot.id, bookedCount: { lt: slot.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (place.count === 0) throw new CapacityError("SLOT_FULL", "This slot just became full. Please choose another time.");

      // The WHOLE weight, in this crop's own capacity, in one guarded update.
      const weight = Math.round(old.quantityKg);
      await ensureCapacityRows(tx, [slot], crop);
      if (!(await reserveWeight(tx, slot.id, crop.id, weight))) {
        throw new CapacityError("SLOT_FULL", `This slot no longer has room for ${weight} kg of ${crop.name}. Please choose another.`);
      }

      const tokenNumber = await nextTokenNumber(tx, slot.centreId, slot.date);
      const caseId = await nextCaseId(tx, slot.date.getUTCFullYear());
      const created = await tx.booking.create({
        data: {
          farmerId: farmer.id, slotId: slot.id, caseId, tokenNumber,
          crop: crop.name, cropId: crop.id, quantityKg: weight, capacityCounted: true, status: "BOOKED",
        },
      });
      await tx.queueEntry.create({ data: { bookingId: created.id, stage: "SLOT_BOOKED" } });
      await tx.emergencyRequest.update({ where: { id: r.id }, data: { newBookingId: created.id } });
      await tx.reschedulingHistory.create({
        data: {
          requestId: r.id, oldBookingId: old.id, newBookingId: created.id, oldSlotId: old.slotId,
          newSlotId: slot.id, crop: crop.name, quantityKg: weight, actorUserId: req.user!.userId,
        },
      });
      await tx.bookingStatusHistory.create({
        data: { bookingId: created.id, fromStatus: null, toStatus: "BOOKED", reason: `Rescheduled after emergency ${r.requestNo}`, actorUserId: req.user!.userId },
      });
      return { created, slot };
    });

    const when = `${ymd(result.slot.date)} ${result.slot.startTime}`;
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "EMERGENCY_RESCHEDULE", {
      bookingId: result.created.id,
      details: { token: result.created.tokenNumber },
    });
    await notifyFarmer(farmer.id, "emergencyRescheduled", `Your new slot is confirmed: ${when}. Token ${result.created.tokenNumber}.`, {
      when, token: result.created.tokenNumber,
    });
    await notifyFarmer(farmer.id, "emergencyReminder", `Reminder: come on ${when} with your Case ID ${result.created.caseId}.`, {
      when, caseId: result.created.caseId,
    });
    sendSms(farmer.user.mobile, `New slot confirmed at ${r.centre.name}: ${when}. Token ${result.created.tokenNumber}. Case ID ${result.created.caseId}.`);
    emitCapacityChanged(r.centreId);
    emitEmergencyUpdated({ id: r.id, status: "RESCHEDULED", centreId: r.centreId }, req.user!.userId);
    return res.status(201).json({
      message: "Rescheduled.",
      booking: {
        id: result.created.id, caseId: result.created.caseId, tokenNumber: result.created.tokenNumber,
        date: result.slot.date, startTime: result.slot.startTime, endTime: result.slot.endTime,
      },
    });
  } catch (err) {
    return sendError(res, err, "Could not confirm the new slot. Please try again.", "rescheduleAfterEmergency");
  }
}

// ---------- officers ----------

async function officerView(id: string, scopeAll: boolean, centreId: string | null) {
  const r = await prisma.emergencyRequest.findUnique({
    where: { id },
    include: {
      ...viewInclude,
      farmer: { select: { fullName: true, farmerCode: true } },
      reviews: { orderBy: { createdAt: "desc" } },
      verifications: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!r || (!scopeAll && r.centreId !== centreId)) return null;
  const earlier = await prisma.emergencyRequest.count({
    where: { farmerId: r.farmerId, id: { not: r.id }, createdAt: { gte: new Date(Date.now() - 90 * 24 * HOUR) } },
  });
  return {
    ...farmerView(r),
    // Only reviewers get these. Never the farmer's phone number or address.
    farmerName: r.farmer.fullName,
    farmerCode: r.farmer.farmerCode,
    tokenNumber: r.booking.tokenNumber,
    centreId: r.centreId,
    supportScore: r.supportScore,
    flagged: r.flagged,
    flagReason: r.flagReason,
    farmerReviewNote: r.farmerReviewNote,
    affectedLat: r.affectedLat,
    affectedLng: r.affectedLng,
    earlierRequests90Days: earlier,
    reviews: r.reviews.map((x) => ({ id: x.id, action: x.action, officerName: x.officerName, remarks: x.remarks, createdAt: x.createdAt })),
    verifications: r.verifications.map((v) => ({
      id: v.id, provider: v.provider, source: v.source, windowStart: v.windowStart, windowEnd: v.windowEnd,
      outcome: v.outcome, supportScore: v.supportScore, reasons: v.reasons, observations: v.observations, createdAt: v.createdAt,
    })),
  };
}

export async function listForOfficers(req: Request, res: Response) {
  try {
    const scope = await staffScope(req);
    if (!scope.all && !scope.centreId) throw new HttpError(404, "Staff profile not found.");
    const q = req.query;
    const where: Prisma.EmergencyRequestWhereInput = {};
    if (scope.all) {
      if (typeof q.centreId === "string" && z.string().uuid().safeParse(q.centreId).success) where.centreId = q.centreId;
    } else {
      where.centreId = scope.centreId!;
    }
    if (typeof q.status === "string" && q.status) {
      if (!(STATUSES as readonly string[]).includes(q.status)) throw new HttpError(400, "Unknown status.");
      where.status = q.status as (typeof STATUSES)[number];
    }
    if (typeof q.category === "string" && q.category) {
      if (!(CATEGORIES as readonly string[]).includes(q.category)) throw new HttpError(400, "Unknown category.");
      where.category = q.category as (typeof CATEGORIES)[number];
    }
    if (typeof q.crop === "string" && q.crop.trim()) where.crop = { equals: q.crop.trim(), mode: "insensitive" };
    if (typeof q.date === "string" && q.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) throw new HttpError(400, "Date must be YYYY-MM-DD.");
      where.slotDate = new Date(`${q.date}T00:00:00.000Z`);
    }
    if (q.flagged === "true") where.flagged = true;

    const rows = await prisma.emergencyRequest.findMany({
      where,
      include: { ...viewInclude, farmer: { select: { fullName: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    res.set("Cache-Control", "no-store");
    return res.json(
      rows.map((r) => ({
        id: r.id, requestNo: r.requestNo, caseId: r.booking.caseId, centreId: r.centreId, centreName: r.centre.name,
        farmerName: r.farmer.fullName, crop: r.crop, quantityKg: r.quantityKg, slotDate: r.slotDate, slotStart: r.slotStart,
        category: r.category, status: r.status, verificationResult: r.outcome, supportScore: r.supportScore,
        flagged: r.flagged, manualReviewRequested: r.manualReviewRequested, evidenceCount: r.evidence.length, createdAt: r.createdAt,
      }))
    );
  } catch (err) {
    return sendError(res, err, "Could not load requests.", "listForOfficers");
  }
}

export async function getForOfficers(req: Request, res: Response) {
  try {
    const scope = await staffScope(req);
    const view = await officerView(req.params.id, scope.all, scope.centreId);
    if (!view) throw new HttpError(404, "Request not found.");
    res.set("Cache-Control", "no-store");
    return res.json(view);
  } catch (err) {
    return sendError(res, err, "Could not load this request.", "getForOfficers");
  }
}

// GET /emergency-cancellations/:id/weather-verification (reviewers only)
export async function getWeatherVerification(req: Request, res: Response) {
  try {
    const { r } = await loadForStaff(req);
    const list = await prisma.weatherVerification.findMany({ where: { requestId: r.id }, orderBy: { createdAt: "desc" }, take: 10 });
    res.set("Cache-Control", "no-store");
    return res.json(list);
  } catch (err) {
    return sendError(res, err, "Could not load the weather check.", "getWeatherVerification");
  }
}

const reviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "FLAG", "UNFLAG", "REQUEST_EVIDENCE"]),
  remarks: z.string().trim().max(500, "Please keep remarks under 500 letters.").optional(),
});

export async function reviewRequest(req: Request, res: Response) {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.errors[0].message);
    const { action } = parsed.data;
    const remarks = parsed.data.remarks ?? "";
    if ((action === "REJECT" || action === "FLAG" || action === "REQUEST_EVIDENCE") && remarks.length < 5) {
      throw new HttpError(400, "Please write remarks (at least 5 letters). They are required for this action.", "REMARKS_REQUIRED");
    }

    const { r, scope } = await loadForStaff(req);
    const farmerRow = await prisma.farmer.findUnique({ where: { id: r.farmerId }, include: { user: { select: { mobile: true, id: true } } } });
    if (!farmerRow) throw new HttpError(404, "Request not found.");
    const actor = { userId: req.user!.userId, role: req.user!.role };

    const note = (tx: Prisma.TransactionClient) =>
      tx.officerReview.create({
        data: { requestId: r.id, officerUserId: actor.userId, officerName: scope.name, action, remarks: remarks || null },
      });

    if (action === "FLAG" || action === "UNFLAG") {
      await prisma.$transaction(async (tx) => {
        await tx.emergencyRequest.update({
          where: { id: r.id },
          data: action === "FLAG" ? { flagged: true, flagReason: "officer" } : { flagged: false, flagReason: null },
        });
        await note(tx);
      });
      // Not linked to the booking, so the farmer's own timeline never shows an internal flag.
      await logAudit(actor, action === "FLAG" ? "EMERGENCY_FLAG" : "EMERGENCY_UNFLAG");
    } else if (action === "REQUEST_EVIDENCE") {
      if (r.status !== "AWAITING_REVIEW") throw new HttpError(409, "Only requests waiting for review can ask for more proof.", "WRONG_STATUS");
      await note(prisma);
      await logAudit(actor, "EMERGENCY_EVIDENCE_REQUEST", { bookingId: r.bookingId });
      await notifyFarmer(r.farmerId, "emergencyEvidenceRequested", `More proof is needed for request ${r.requestNo}: ${remarks}`, {
        requestNo: r.requestNo, remarks,
      });
      sendSms(farmerRow.user.mobile, `Request ${r.requestNo}: the centre needs more proof. ${remarks}`.slice(0, 300));
    } else if (action === "REJECT") {
      await prisma.$transaction(async (tx) => {
        const g = await tx.emergencyRequest.updateMany({
          where: { id: r.id, status: "AWAITING_REVIEW" },
          data: { status: "REJECTED", decision: "REJECTED", decisionRemarks: remarks, decidedByUserId: actor.userId, decidedAt: new Date() },
        });
        if (g.count === 0) throw new HttpError(409, "This request was already decided or is not ready for a decision.", "WRONG_STATUS");
        await note(tx);
      });
      await logAudit(actor, "EMERGENCY_REJECT", { bookingId: r.bookingId });
      await notifyFarmer(r.farmerId, "emergencyRejected", `Request ${r.requestNo} was not approved. Reason: ${remarks}`, {
        requestNo: r.requestNo, remarks,
      });
      sendSms(farmerRow.user.mobile, `Request ${r.requestNo} was not approved. Reason: ${remarks}. You can ask for another review in the app.`.slice(0, 300));
    } else {
      // APPROVE: the only place weight is given back for an emergency.
      await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({ where: { id: r.bookingId }, include: { queueEntry: true } });
        if (!booking) throw new HttpError(404, "Booking not found.");
        const g = await tx.emergencyRequest.updateMany({
          where: { id: r.id, status: "AWAITING_REVIEW" },
          data: {
            status: booking.cropId ? "RESCHEDULING_AVAILABLE" : "APPROVED",
            decision: "APPROVED", decisionRemarks: remarks || null, decidedByUserId: actor.userId, decidedAt: new Date(),
          },
        });
        if (g.count === 0) throw new HttpError(409, "This request was already decided or is not ready for a decision.", "WRONG_STATUS");

        if ((booking.queueEntry?.stage ?? "SLOT_BOOKED") !== "SLOT_BOOKED") {
          throw new HttpError(409, "The farmer has already arrived at the centre, so this booking can't be cancelled. Please reject the request with a remark.", "ALREADY_ARRIVED");
        }
        const cancelled = await tx.booking.updateMany({ where: { id: booking.id, status: "BOOKED" }, data: { status: "CANCELLED" } });
        if (cancelled.count === 0) throw new HttpError(409, "This booking is no longer active, so nothing could be cancelled.", "NOT_ACTIVE");
        await tx.slot.updateMany({ where: { id: booking.slotId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 } } });
        await releaseBookingCapacity(tx, booking.id); // gives the weight back once, to this crop only
        await tx.bookingStatusHistory.create({
          data: { bookingId: booking.id, fromStatus: "BOOKED", toStatus: "CANCELLED", reason: `Emergency ${r.requestNo} approved`, actorUserId: actor.userId },
        });
        await note(tx);
      });
      emitCapacityChanged(r.centreId);
      {
        const released = await prisma.booking.findUnique({ where: { id: r.bookingId }, select: { slotId: true, cropId: true, quantityKg: true } });
        if (released) await onCapacityReleased({ slotId: released.slotId, cropId: released.cropId, kg: Math.round(released.quantityKg), trigger: "EMERGENCY", actor });
      }
      try {
        getIO().to(`centre:${r.centreId}`).emit("stage-updated", { centreId: r.centreId, bookingId: r.bookingId, stage: "SLOT_BOOKED", status: "CANCELLED" });
      } catch {
        /* live update is a bonus */
      }
      await logAudit(actor, "EMERGENCY_APPROVE", { bookingId: r.bookingId });
      await notifyFarmer(r.farmerId, "emergencyApproved", `Request ${r.requestNo} was approved. Your slot is cancelled. Choose a new time in the app.`, {
        requestNo: r.requestNo,
      });
      sendSms(farmerRow.user.mobile, `Request ${r.requestNo} was approved. Open the app to choose a new time.`);
    }

    const fresh = await prisma.emergencyRequest.findUnique({ where: { id: r.id }, select: { id: true, status: true, centreId: true } });
    if (fresh) emitEmergencyUpdated(fresh, farmerRow.user.id);
    return res.json(await officerView(r.id, scope.all, scope.centreId));
  } catch (err) {
    return sendError(res, err, "Could not save your decision. Please try again.", "reviewRequest");
  }
}

// Run the weather and evidence check again (for example after the weather
// service was down, or after the farmer added files).
export async function reverify(req: Request, res: Response) {
  try {
    const { r, scope } = await loadForStaff(req);
    if (r.status !== "AWAITING_REVIEW" && r.status !== "UNDER_VERIFICATION") {
      throw new HttpError(409, "Only requests that are still being reviewed can be checked again.", "WRONG_STATUS");
    }
    await prisma.officerReview.create({
      data: { requestId: r.id, officerUserId: req.user!.userId, officerName: scope.name, action: "REVERIFY", remarks: null },
    });
    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "EMERGENCY_VERIFY", { bookingId: r.bookingId });
    await runVerification(r.id, req.user!.userId);
    return res.json(await officerView(r.id, scope.all, scope.centreId));
  } catch (err) {
    return sendError(res, err, "Could not run the check again.", "reverify");
  }
}
