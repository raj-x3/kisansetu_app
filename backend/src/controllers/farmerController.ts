// This is intentionally the FIRST protected endpoint we build.
// It proves the whole authentication chain works before we add
// any real procurement features on top of it:
//
//   Frontend sends token → authenticate middleware verifies it
//   → authorize middleware checks role → this function runs.

import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";

export async function getMyProfile(req: Request, res: Response) {
  const userId = req.user!.userId; // guaranteed to exist by `authenticate` middleware

  const farmer = await prisma.farmer.findUnique({
    where: { userId },
    include: { user: true, preferredCentre: true },
  });

  if (!farmer) {
    return res.status(404).json({ error: "Farmer profile not found." });
  }

  return res.json({
    farmerCode: farmer.farmerCode,
    fullName: farmer.fullName,
    mobile: farmer.user.mobile,
    address: farmer.address,
    district: farmer.district,
    state: farmer.state,
    preferredCentre: farmer.preferredCentre?.name ?? null,
  });
}
