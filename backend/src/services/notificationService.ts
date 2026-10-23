// Creates an in-app notification for a farmer and pushes it live to
// their open browser tab.
//
// We store a machine-readable `type` plus `params` (e.g. type
// "weighed", params {"kg": 500}) and the frontend turns that into a
// sentence in the farmer's chosen language. `message` is only an
// English fallback.
//
// Like SMS and audit logging, a failure here never blocks the action
// that triggered it.

import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";

export type NotificationType =
  | "bookingConfirmed"
  | "arrived"
  | "verified"
  | "qualityAccepted"
  | "qualityRejected"
  | "weighed"
  | "completed"
  | "paymentInitiated"
  | "paymentProcessing"
  | "paymentCredited"
  | "paymentFailed"
  | "yourTurn"
  | "approaching"
  | "documentReviewed";

export async function notifyFarmer(
  farmerId: string,
  type: NotificationType,
  message: string,
  params: Record<string, string | number> = {}
): Promise<void> {
  try {
    const farmer = await prisma.farmer.findUnique({ where: { id: farmerId }, select: { userId: true } });
    if (!farmer) return;

    const created = await prisma.notification.create({
      data: { farmerId, type, message, params: params as Prisma.InputJsonObject },
    });

    getIO().to(`user:${farmer.userId}`).emit("notification", {
      id: created.id,
      type: created.type,
      params: created.params,
      message: created.message,
      isRead: created.isRead,
      createdAt: created.createdAt,
    });
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}
