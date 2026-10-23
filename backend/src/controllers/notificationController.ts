import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";

async function getFarmerId(userId: string): Promise<string | null> {
  const farmer = await prisma.farmer.findUnique({ where: { userId }, select: { id: true } });
  return farmer?.id ?? null;
}

// A farmer can only ever see their own notifications — the farmer is
// looked up from the login token, never from anything the client sends.
export async function listMine(req: Request, res: Response) {
  const farmerId = await getFarmerId(req.user!.userId);
  if (!farmerId) return res.status(404).json({ error: "Farmer profile not found." });

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { farmerId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { farmerId, isRead: false } }),
  ]);
  return res.json({ items, unreadCount });
}

export async function markAllRead(req: Request, res: Response) {
  const farmerId = await getFarmerId(req.user!.userId);
  if (!farmerId) return res.status(404).json({ error: "Farmer profile not found." });

  await prisma.notification.updateMany({ where: { farmerId, isRead: false }, data: { isRead: true } });
  return res.json({ message: "All notifications marked as read." });
}
