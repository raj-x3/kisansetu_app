// Admin-only endpoints. Everything here reads from the same database
// the farmers and operators write to, so the numbers on the admin
// dashboard are always the real, current state of the system — nothing
// is cached or faked.

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prismaClient";
import { logAudit } from "../services/auditService";
import { hashPassword } from "../utils/password";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Query-string filters for the analytics dashboard: startDate, endDate
// (YYYY-MM-DD, inclusive), centreId, crop, district. Every one is
// independently optional — leaving a dimension blank means "don't
// restrict by that dimension," never a silent default like "today."
//
// Design choice, made deliberately to keep this safe to ship without
// being able to run it against a real database in this environment:
// rather than building a differently-shaped nested `where` clause for
// each of Booking/Procurement/Payment/QueueEntry by hand (four
// different relation paths, real risk of a silently-wrong merge when
// combining filters), we resolve ONE list of matching Booking IDs up
// front — Booking has the most direct path to all four filter
// dimensions (slot→centreId, slot→date, crop direct, farmer→district
// direct) — and then scope every other model with a simple, flat
// `bookingId: { in: [...] }` (or one safe relation hop for Payment,
// which only has `procurementId`). When no filters are given at all,
// this whole mechanism is skipped and the original, unfiltered queries
// run exactly as before — zero behavior change for the default view.
interface AnalyticsFilters {
  startDate?: string;
  endDate?: string;
  centreId?: string;
  crop?: string;
  district?: string;
}

function hasAnyFilter(f: AnalyticsFilters): boolean {
  return Boolean(f.startDate || f.endDate || f.centreId || f.crop || f.district);
}

async function resolveMatchingBookingIds(f: AnalyticsFilters): Promise<string[]> {
  const dateFilter =
    f.startDate || f.endDate
      ? {
          ...(f.startDate ? { gte: new Date(`${f.startDate}T00:00:00.000Z`) } : {}),
          ...(f.endDate ? { lte: new Date(`${f.endDate}T00:00:00.000Z`) } : {}),
        }
      : undefined;

  const bookings = await prisma.booking.findMany({
    where: {
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      ...(f.crop ? { crop: f.crop } : {}),
      ...(f.district ? { farmer: { district: f.district } } : {}),
      ...(f.centreId || dateFilter
        ? {
            slot: {
              ...(f.centreId ? { centreId: f.centreId } : {}),
              ...(dateFilter ? { date: dateFilter } : {}),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return bookings.map((b) => b.id);
}

export async function getAnalytics(req: Request, res: Response) {
  const today = startOfToday();
  const filters: AnalyticsFilters = {
    startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === "string" ? req.query.endDate : undefined,
    centreId: typeof req.query.centreId === "string" ? req.query.centreId : undefined,
    crop: typeof req.query.crop === "string" ? req.query.crop : undefined,
    district: typeof req.query.district === "string" ? req.query.district : undefined,
  };
  const filtering = hasAnyFilter(filters);
  const bookingIds = filtering ? await resolveMatchingBookingIds(filters) : null;
  // Prisma's "in" on an empty array correctly matches nothing, which is
  // exactly right here: filters that match zero bookings should show
  // zero everywhere, not silently fall back to "everything."
  const byBooking = bookingIds !== null ? { bookingId: { in: bookingIds } } : {};
  const byBookingViaProcurement = bookingIds !== null ? { procurement: { bookingId: { in: bookingIds } } } : {};

  const [
    totalFarmers,
    activeCentres,
    todaysBookings,
    farmersWaiting,
    stageGroups,
    paymentGroups,
    completedAgg,
    weightAgg,
    pendingPayments,
    completedPayments,
    centres,
    bookingCentreRows,
    completedProcurements,
  ] = await Promise.all([
    // A district filter narrows the farmer count directly — every other
    // filter dimension doesn't have an obvious meaning for "how many
    // farmers are registered," so it's left as the global total.
    filters.district ? prisma.farmer.count({ where: { district: filters.district } }) : prisma.farmer.count(),
    prisma.procurementCentre.count({ where: { isActive: true } }),
    filtering
      ? prisma.booking.count({ where: { id: { in: bookingIds! } } })
      : prisma.booking.count({ where: { status: { notIn: ["CANCELLED", "NO_SHOW"] }, slot: { date: today } } }),
    // Deliberately NEVER filtered — this is "how many people are
    // physically waiting right now," a live operational number, not a
    // historical report figure that a date range should be able to change.
    prisma.queueEntry.count({
      where: { stage: { not: "COMPLETED" }, booking: { status: "BOOKED", slot: { date: today } } },
    }),
    prisma.queueEntry.groupBy({ by: ["stage"], _count: { _all: true }, where: filtering ? byBooking : undefined }),
    prisma.payment.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: filtering ? byBookingViaProcurement : undefined,
    }),
    prisma.procurement.aggregate({
      where: filtering ? { status: "COMPLETED", ...byBooking } : { status: "COMPLETED" },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.weighment.aggregate({
      where: filtering ? { procurement: { bookingId: { in: bookingIds! } } } : undefined,
      _sum: { netWeightKg: true },
    }),
    prisma.payment.count({
      where: filtering
        ? { status: { in: ["PENDING", "INITIATED", "PROCESSING"] }, ...byBookingViaProcurement }
        : { status: { in: ["PENDING", "INITIATED", "PROCESSING"] } },
    }),
    prisma.payment.count({
      where: filtering ? { status: "CREDITED", ...byBookingViaProcurement } : { status: "CREDITED" },
    }),
    prisma.procurementCentre.findMany({ select: { id: true, name: true } }),
    prisma.booking.findMany({
      where: filtering ? { id: { in: bookingIds! } } : undefined,
      select: { slot: { select: { centreId: true } } },
    }),
    prisma.procurement.findMany({
      where: filtering ? { status: "COMPLETED", ...byBooking } : { status: "COMPLETED" },
      select: { centreId: true, weighment: { select: { netWeightKg: true } } },
    }),
  ]);

  const bookingsByCentre: Record<string, number> = {};
  for (const b of bookingCentreRows) {
    bookingsByCentre[b.slot.centreId] = (bookingsByCentre[b.slot.centreId] ?? 0) + 1;
  }

  const kgByCentre: Record<string, number> = {};
  for (const p of completedProcurements) {
    kgByCentre[p.centreId] = (kgByCentre[p.centreId] ?? 0) + (p.weighment?.netWeightKg ?? 0);
  }

  return res.json({
    filtersApplied: filtering,
    summary: {
      totalFarmers,
      activeCentres,
      todaysBookings,
      farmersWaiting,
      completedProcurement: completedAgg._count._all,
      totalQuantityKg: weightAgg._sum.netWeightKg ?? 0,
      totalValue: completedAgg._sum.totalAmount ?? 0,
      pendingPayments,
      completedPayments,
    },
    charts: {
      bookingsPerCentre: centres.map((c) => ({ name: c.name, count: bookingsByCentre[c.id] ?? 0 })),
      quantityPerCentre: centres.map((c) => ({ name: c.name, kg: kgByCentre[c.id] ?? 0 })),
      stages: stageGroups.map((s) => ({ stage: s.stage, count: s._count._all })),
      paymentStatus: paymentGroups.map((p) => ({ status: p.status, count: p._count._all })),
    },
  });
}

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const centreSchema = z.object({
  name: z.string().min(2, "Centre name is required."),
  location: z.string().min(2, "Location is required."),
  district: z.string().min(2, "District is required."),
  state: z.string().min(2, "State is required."),
  dailyCapacity: z.number().int().positive("Daily capacity must be greater than zero."),
  operatingStart: z.string().regex(timeRegex, "Opening time must look like 09:00."),
  operatingEnd: z.string().regex(timeRegex, "Closing time must look like 17:00."),
  numMachines: z.number().int().min(1, "At least one machine is required."),
  numOperators: z.number().int().min(1, "At least one operator is required."),
  avgProcessingMin: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function listAllCentres(_req: Request, res: Response) {
  const centres = await prisma.procurementCentre.findMany({ orderBy: { name: "asc" } });
  return res.json(centres);
}

export async function createCentre(req: Request, res: Response) {
  const parsed = centreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  if (parsed.data.operatingStart >= parsed.data.operatingEnd) {
    return res.status(400).json({ error: "Closing time must be after opening time." });
  }

  const centre = await prisma.procurementCentre.create({ data: parsed.data });
  await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CENTRE_CREATE", {
    details: { name: centre.name },
  });
  return res.status(201).json(centre);
}

// Note: slots for a date are generated the first time anyone asks for
// that date (see slotService.ts) and then saved. Changing a centre's
// capacity or hours here affects dates that haven't been generated yet;
// dates whose slots already exist keep the numbers they were created with.
export async function updateCentre(req: Request, res: Response) {
  const parsed = centreSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const existing = await prisma.procurementCentre.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Centre not found." });

  const start = parsed.data.operatingStart ?? existing.operatingStart;
  const end = parsed.data.operatingEnd ?? existing.operatingEnd;
  if (start >= end) return res.status(400).json({ error: "Closing time must be after opening time." });

  const centre = await prisma.procurementCentre.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  await logAudit({ userId: req.user!.userId, role: req.user!.role }, "CENTRE_UPDATE", {
    details: { name: centre.name, active: centre.isActive },
  });
  return res.json(centre);
}

// Read-only, newest first. There is intentionally no endpoint that can
// edit or delete an audit entry.
export async function getAuditLogs(_req: Request, res: Response) {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return res.json(logs);
}


// ---------- Demand forecasting + bottleneck insights ----------
//
// The forecast calls the Python ML service (a real, separate
// RandomForestRegressor — see ml-service/app/demand_train.py), fed with
// each centre's ACTUAL configured capacity and its ACTUAL recent
// booking average from the database. The bottleneck insights below it
// are plain derived facts from the same database — no AI, no invented
// text, exactly per the original spec.

interface CentreForecast {
  centreId: string;
  centreName: string;
  capacity: number;
  expectedFarmers: number;
  overload: boolean;
}

async function forecastAllCentres(): Promise<CentreForecast[]> {
  const centres = await prisma.procurementCentre.findMany({ where: { isActive: true } });
  const today = startOfToday();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const tomorrowDayOfWeek = (new Date(today).getDay() + 6) % 7; // convert Sun=0..Sat=6 to Mon=0..Sun=6

  const results: CentreForecast[] = [];

  for (const centre of centres) {
    // Historical demand signal for the forecast model — this should
    // reflect real booking VOLUME over the last 7 days, not just
    // bookings that happen to still be mid-workflow.
    const recentBookingCount = await prisma.booking.count({
      where: {
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        slot: { centreId: centre.id, date: { gte: sevenDaysAgo, lt: today } },
      },
    });
    const recentAvgBookings = recentBookingCount / 7;

    try {
      const response = await fetch(`${ML_SERVICE_URL}/forecast-demand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centre_capacity: centre.dailyCapacity,
          day_of_week: tomorrowDayOfWeek,
          recent_avg_bookings: recentAvgBookings,
        }),
      });
      if (!response.ok) throw new Error(`ML service responded with ${response.status}`);
      const data = await response.json();
      const expectedFarmers: number = data.expected_farmers;

      results.push({
        centreId: centre.id,
        centreName: centre.name,
        capacity: centre.dailyCapacity,
        expectedFarmers,
        overload: expectedFarmers > centre.dailyCapacity,
      });
    } catch (err) {
      console.error(`Demand forecast failed for centre ${centre.name}:`, err);
      // Skip this centre's forecast rather than failing the whole
      // dashboard — the admin still sees every other centre and every
      // database-derived insight below.
    }
  }

  return results;
}

export async function getInsights(_req: Request, res: Response) {
  const today = startOfToday();

  const forecast = await forecastAllCentres();

  const insights: { type: string; params: Record<string, string | number> }[] = [];

  for (const f of forecast) {
    if (f.overload) {
      insights.push({
        type: "demandOverload",
        params: { centre: f.centreName, expected: Math.round(f.expectedFarmers), capacity: f.capacity },
      });
    }
  }

  // Real utilization today, per active centre — no forecast involved,
  // just today's actual booking count against actual configured capacity.
  const centres = await prisma.procurementCentre.findMany({ where: { isActive: true } });
  for (const centre of centres) {
    // Same reasoning as recentBookingCount above — a fully-processed
    // busy day should still register as busy for congestion purposes.
    const todaysCount = await prisma.booking.count({
      where: { status: { notIn: ["CANCELLED", "NO_SHOW"] }, slot: { centreId: centre.id, date: today } },
    });
    const utilization = todaysCount / Math.max(centre.dailyCapacity, 1);
    if (utilization >= 0.9) {
      insights.push({
        type: "highCongestion",
        params: { centre: centre.name, percent: Math.round(utilization * 100) },
      });
    } else if (utilization <= 0.3) {
      insights.push({
        type: "spareCapacity",
        params: { centre: centre.name, percent: Math.round(utilization * 100) },
      });
    }
  }

  // Real bottleneck signal: which non-final stage currently has the
  // most farmers sitting in it, across today's active bookings.
  const stageGroups = await prisma.queueEntry.groupBy({
    by: ["stage"],
    _count: { _all: true },
    where: { stage: { not: "COMPLETED" }, booking: { status: "BOOKED", slot: { date: today } } },
  });
  const slowest = stageGroups.sort((a, b) => b._count._all - a._count._all)[0];
  if (slowest && slowest._count._all >= 3) {
    insights.push({ type: "slowStage", params: { stage: slowest.stage, count: slowest._count._all } });
  }

  // Real payment backlog signal.
  const [pendingPayments, creditedPayments] = await Promise.all([
    prisma.payment.count({ where: { status: { in: ["PENDING", "INITIATED", "PROCESSING"] } } }),
    prisma.payment.count({ where: { status: "CREDITED" } }),
  ]);
  if (pendingPayments >= 3 && pendingPayments > creditedPayments) {
    insights.push({ type: "paymentBacklog", params: { pending: pendingPayments } });
  }

  return res.json({ forecast, insights });
}

// ---------- Staff accounts ----------
// Officers and managers cannot sign themselves up (anyone could then make
// themselves an officer). Only an ADMIN creates their accounts, here.
// The password is hashed; it is never stored or logged in plain text.

const staffSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required"),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum([
    "MANAGER",
    "GATE_OFFICER",
    "DOCUMENT_OFFICER",
    "QUALITY_OFFICER",
    "WEIGHT_OFFICER",
    "PROCUREMENT_OFFICER",
    "PAYMENT_OFFICER",
  ]),
  centreId: z.string().min(1, "Please choose a centre"),
});

export async function createStaffUser(req: Request, res: Response) {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { fullName, mobile, password, role, centreId } = parsed.data;

    const centre = await prisma.procurementCentre.findUnique({ where: { id: centreId } });
    if (!centre) return res.status(404).json({ error: "Centre not found." });

    const existing = await prisma.user.findUnique({ where: { mobile } });
    if (existing) return res.status(409).json({ error: "An account with this mobile number already exists." });

    const user = await prisma.user.create({
      data: {
        mobile,
        passwordHash: await hashPassword(password),
        role,
        operator: { create: { fullName, centreId } },
      },
    });

    await logAudit({ userId: req.user!.userId, role: req.user!.role }, "USER_CREATE", {
      details: { name: fullName, staffRole: role },
    });
    return res.status(201).json({ id: user.id, mobile: user.mobile, role: user.role, fullName, centreName: centre.name });
  } catch (err) {
    console.error("createStaffUser failed:", err);
    return res.status(500).json({ error: "Could not create the account. Please try again." });
  }
}
