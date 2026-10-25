// Document upload and review.
//
// - Farmers upload files for their own booking (before verification).
// - Document officers (and the legacy Operator) review them at their
//   own centre: verify, reject, or ask for a correction.
// Every handler is wrapped so a problem returns a clear message instead
// of crashing the server.

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { logAudit } from "../services/auditService";
import { notifyFarmer } from "../services/notificationService";
import { getIO } from "../socket";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_BOOKING,
  detectMimeType,
  cleanFileName,
} from "../services/documentService";

const uploadSchema = z.object({
  type: z.enum(["IDENTITY_PROOF", "LAND_RECORD", "OTHER"]),
  fileName: z.string().min(1).max(200),
  dataBase64: z.string().min(1),
});

const reviewSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED", "CORRECTION_REQUESTED"]),
  note: z.string().max(300).optional(),
});

// Never include `data` (the file bytes) in list responses.
const LIST_SELECT = {
  id: true,
  bookingId: true,
  type: true,
  status: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
} as const;

async function officerCentreId(userId: string): Promise<string | null> {
  const op = await prisma.operator.findUnique({ where: { userId } });
  return op?.centreId ?? null;
}

// Can this logged-in user see documents of this booking?
async function canAccessBooking(
  req: Request,
  bookingId: string
): Promise<{ ok: boolean; booking?: { id: string; farmerId: string; tokenNumber: number; queueStage: string; status: string } }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true, farmer: true, queueEntry: true },
  });
  if (!booking) return { ok: false };
  const summary = {
    id: booking.id,
    farmerId: booking.farmerId,
    tokenNumber: booking.tokenNumber,
    queueStage: booking.queueEntry?.stage ?? "SLOT_BOOKED",
    status: booking.status,
  };
  if (req.user!.role === "FARMER") {
    return booking.farmer.userId === req.user!.userId ? { ok: true, booking: summary } : { ok: false };
  }
  const centreId = await officerCentreId(req.user!.userId);
  return centreId && centreId === booking.slot.centreId ? { ok: true, booking: summary } : { ok: false };
}

export async function uploadDocument(req: Request, res: Response) {
  try {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please choose a document type and a file." });

    const access = await canAccessBooking(req, req.params.bookingId);
    if (!access.ok || !access.booking) return res.status(404).json({ error: "Booking not found." });
    const booking = access.booking;

    if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
      return res.status(409).json({ error: "This booking was cancelled." });
    }
    if (!["SLOT_BOOKED", "ARRIVED"].includes(booking.queueStage)) {
      return res.status(409).json({ error: "Documents can only be added before verification is finished." });
    }

    const bytes = Buffer.from(parsed.data.dataBase64, "base64");
    if (bytes.length === 0) return res.status(400).json({ error: "The file looks empty." });
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({ error: "The file is too big. Maximum size is 2 MB." });
    }
    const mimeType = detectMimeType(bytes);
    if (!mimeType) return res.status(400).json({ error: "Only PDF, JPG or PNG files are allowed." });

    const count = await prisma.document.count({ where: { bookingId: booking.id } });
    if (count >= MAX_DOCUMENTS_PER_BOOKING) {
      return res.status(409).json({ error: "You have reached the limit of documents for this booking." });
    }

    // A document that is already VERIFIED can't be replaced by a new upload of the same type.
    const latestSameType = await prisma.document.findFirst({
      where: { bookingId: booking.id, type: parsed.data.type },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (latestSameType && (latestSameType.status === "VERIFIED" || latestSameType.status === "PENDING")) {
      return res.status(409).json({
        error:
          latestSameType.status === "VERIFIED"
            ? "This document is already verified."
            : "This document is already waiting for review.",
      });
    }

    const doc = await prisma.document.create({
      data: {
        bookingId: booking.id,
        farmerId: booking.farmerId,
        type: parsed.data.type,
        fileName: cleanFileName(parsed.data.fileName),
        mimeType,
        sizeBytes: bytes.length,
        data: bytes,
      },
      select: LIST_SELECT,
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "DOCUMENT_UPLOAD", {
      bookingId: booking.id,
      details: { token: booking.tokenNumber, docType: doc.type },
    });
    return res.status(201).json(doc);
  } catch (err) {
    console.error("uploadDocument failed:", err);
    return res.status(500).json({ error: "Could not save the document. Please try again." });
  }
}

export async function listDocuments(req: Request, res: Response) {
  try {
    const access = await canAccessBooking(req, req.params.bookingId);
    if (!access.ok) return res.status(404).json({ error: "Booking not found." });
    const docs = await prisma.document.findMany({
      where: { bookingId: req.params.bookingId },
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return res.json(docs);
  } catch (err) {
    console.error("listDocuments failed:", err);
    return res.status(500).json({ error: "Could not load documents." });
  }
}

export async function getDocumentFile(req: Request, res: Response) {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Document not found." });
    const access = await canAccessBooking(req, doc.bookingId);
    if (!access.ok) return res.status(404).json({ error: "Document not found." });

    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${doc.fileName}"`);
    return res.send(Buffer.from(doc.data));
  } catch (err) {
    console.error("getDocumentFile failed:", err);
    return res.status(500).json({ error: "Could not open the document." });
  }
}

export async function reviewDocument(req: Request, res: Response) {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid review." });
    const { decision } = parsed.data;
    const note = parsed.data.note?.trim() || undefined;
    if (decision !== "VERIFIED" && !note) {
      return res.status(400).json({ error: "Please write a short reason for the farmer." });
    }

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Document not found." });
    const access = await canAccessBooking(req, doc.bookingId);
    if (!access.ok || !access.booking) return res.status(404).json({ error: "Document not found at your centre." });

    if (doc.status === "VERIFIED") {
      return res.status(409).json({ error: "This document is already verified." });
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: decision,
        reviewNote: decision === "VERIFIED" ? null : note,
        reviewedByUserId: req.user!.userId,
        reviewedAt: new Date(),
      },
      select: LIST_SELECT,
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "DOCUMENT_REVIEW", {
      bookingId: doc.bookingId,
      details: { token: access.booking.tokenNumber, docType: doc.type, docStatus: decision },
    });
    await notifyFarmer(
      doc.farmerId,
      "documentReviewed",
      `Your ${doc.type} document was reviewed: ${decision}.`,
      { docType: doc.type, docStatus: decision }
    );
    try {
      getIO().to(`user:${(await prisma.farmer.findUnique({ where: { id: doc.farmerId }, select: { userId: true } }))?.userId}`).emit("documents-updated", {
        bookingId: doc.bookingId,
      });
    } catch {
      /* live update is a bonus — never block the review */
    }
    return res.json(updated);
  } catch (err) {
    console.error("reviewDocument failed:", err);
    return res.status(500).json({ error: "Could not save the review." });
  }
}
