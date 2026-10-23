import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";

export async function listCentres(_req: Request, res: Response) {
  const centres = await prisma.procurementCentre.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      location: true,
      district: true,
      state: true,
      operatingStart: true,
      operatingEnd: true,
      dailyCapacity: true,
    },
    orderBy: { name: "asc" },
  });
  res.json(centres);
}

export async function getCentre(req: Request, res: Response) {
  const centre = await prisma.procurementCentre.findUnique({ where: { id: req.params.id } });
  if (!centre) return res.status(404).json({ error: "Procurement centre not found." });
  res.json(centre);
}
