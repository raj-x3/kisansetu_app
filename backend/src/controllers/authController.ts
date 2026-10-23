// Handles the two public authentication endpoints:
//   POST /api/auth/register  (farmers sign themselves up)
//   POST /api/auth/login     (any role logs in)
//
// Operator and Admin accounts are NOT self-registered here —
// per the product spec, those are created by an administrator.
// For the SIH demo, they're created by the seed script instead
// (see prisma/seed.ts, built in a later module).

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { hashPassword, verifyPassword } from "../utils/password";
import { signToken } from "../utils/jwt";
import { sendSms } from "../services/smsService";

// zod schemas validate the shape of incoming data before we
// touch the database, so bad/missing fields are rejected early
// with a clear error message instead of crashing later.

const registerSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  email: z.string().email().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  address: z.string().min(3, "Address is required"),
  district: z.string().min(2, "District is required"),
  state: z.string().min(2, "State is required"),
});

const loginSchema = z.object({
  mobileOrEmail: z.string().min(3),
  password: z.string().min(1),
});

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { fullName, mobile, email, password, address, district, state } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { mobile } });
  if (existing) {
    return res.status(409).json({ error: "An account with this mobile number already exists." });
  }

  const passwordHash = await hashPassword(password);

  // Generate a human-readable Farmer ID, e.g. FARM-2026-0001.
  // We count existing farmers to pick the next number. For a
  // high-traffic production system you'd want a database
  // sequence instead of a count, but this is fine for the demo.
  const farmerCount = await prisma.farmer.count();
  const farmerCode = `FARM-${new Date().getFullYear()}-${String(farmerCount + 1).padStart(4, "0")}`;

  const user = await prisma.user.create({
    data: {
      mobile,
      email,
      passwordHash,
      role: "FARMER",
      farmer: {
        create: {
          fullName,
          address,
          district,
          state,
          farmerCode,
        },
      },
    },
    include: { farmer: true },
  });

  const token = signToken({ userId: user.id, role: "FARMER" });

  // Fire the welcome SMS after the account is safely created — this
  // never blocks or fails the registration itself if SMS is down.
  sendSms(
    mobile,
    `Welcome to Kisan Procurement Setu! Your Farmer ID is ${farmerCode}. You can now log in and book a procurement slot.`
  );

  return res.status(201).json({
    message: "Registration successful.",
    token,
    user: {
      id: user.id,
      role: user.role,
      farmerCode: user.farmer?.farmerCode,
      fullName: user.farmer?.fullName,
    },
  });
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Mobile/email and password are required." });
  }
  const { mobileOrEmail, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ mobile: mobileOrEmail }, { email: mobileOrEmail }],
    },
    include: { farmer: true, operator: true },
  });

  // Deliberately vague error message — we don't reveal whether
  // the mobile/email exists, only that the combination is wrong.
  const invalidCredentials = () =>
    res.status(401).json({ error: "Incorrect mobile/email or password." });

  if (!user) return invalidCredentials();

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) return invalidCredentials();

  const token = signToken({ userId: user.id, role: user.role });

  return res.json({
    message: "Login successful.",
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.farmer?.fullName ?? user.operator?.fullName ?? "Administrator",
    },
  });
}
