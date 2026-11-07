// Writes one row to the audit log for every important action.
//
// If writing the log fails, we record the failure in the server log but
// do NOT block the action itself (same choice as SMS). That's a
// prototype trade-off; a production system handling real money would
// normally refuse to proceed when it can't record an audit entry.

import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prismaClient";

export type AuditAction =
  | "BOOKING_CREATE"
  | "BOOKING_CANCEL"
  | "BOOKING_RESCHEDULE"
  | "MARK_NO_SHOW"
  | "BOOKING_WEIGHT_CHANGE"
  | "CROP_CREATE"
  | "CROP_UPDATE"
  | "CAPACITY_UPDATE"
  | "CALL_NEXT"
  | "MARK_ARRIVED"
  | "MARK_VERIFIED"
  | "QUALITY_CHECK"
  | "WEIGHING"
  | "COMPLETE_PROCUREMENT"
  | "PAYMENT_INITIATE"
  | "PAYMENT_PROCESS"
  | "PAYMENT_CREDIT"
  | "PAYMENT_FAIL"
  | "DOCUMENT_UPLOAD"
  | "DOCUMENT_REVIEW"
  | "CENTRE_CREATE"
  | "CENTRE_UPDATE"
  | "USER_CREATE"
  | "EMERGENCY_SUBMIT"
  | "EMERGENCY_EVIDENCE_ADD"
  | "EMERGENCY_VERIFY"
  | "EMERGENCY_APPROVE"
  | "EMERGENCY_REJECT"
  | "EMERGENCY_FLAG"
  | "EMERGENCY_UNFLAG"
  | "EMERGENCY_EVIDENCE_REQUEST"
  | "EMERGENCY_REVIEW_REQUEST"
  | "EMERGENCY_RESCHEDULE"
  | "QUEUE_STATUS_UPDATE"
  | "WAITLIST_JOIN"
  | "WAITLIST_WITHDRAW"
  | "OFFER_ACCEPT"
  | "OFFER_DECLINE"
  | "WAITLIST_PAUSE"
  | "WAITLIST_RESUME"
  | "WAITLIST_REDISTRIBUTE"
  | "OFFER_WINDOW_UPDATE"
  | "SIMULATED_ADD_FARMERS"
  | "SIMULATED_STAGE_ADVANCE"
  | "SIMULATED_PAYMENT_ADVANCE"
  | "SIMULATED_RESET";

async function resolveActorName(userId: string, role: string): Promise<string> {
  if (role === "FARMER") {
    return (await prisma.farmer.findUnique({ where: { userId } }))?.fullName ?? "Farmer";
  }
  if (role === "ADMIN") return "Administrator";
  // OPERATOR, MANAGER and every officer role have an Operator row.
  return (await prisma.operator.findUnique({ where: { userId } }))?.fullName ?? role;
}

// `details` holds language-neutral facts (token number, kg, amount…) —
// the admin screen turns them into text in the viewer's language.
export async function logAudit(
  actor: { userId: string; role: string },
  action: AuditAction,
  opts: { bookingId?: string; details?: Record<string, string | number | boolean> } = {}
): Promise<void> {
  try {
    const actorName = await resolveActorName(actor.userId, actor.role);
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: actor.role,
        actorName,
        action,
        bookingId: opts.bookingId,
        details: opts.details as Prisma.InputJsonObject | undefined,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}
