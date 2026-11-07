// Live queue: real processing timings, waiting-time estimates, congestion
// look-ahead and delay notifications. Everything here reads the database;
// the maths itself lives in utils/queueEstimate.ts.

import { Prisma, ProcurementCentre, ProcurementStage } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { queueConfig } from "../config/queue";
import { emergencyConfig } from "../config/emergency";
import { notifyFarmer, NotificationType } from "./notificationService";
import { sendSms } from "./smsService";
import { getIO } from "../socket";
import {
  Stage,
  STAGE_REMAINING,
  ServiceTime,
  Estimate,
  QueueLevel,
  rollingServiceTime,
  effectiveCounters,
  estimateWait,
  classifyCentre,
  predictCongestion,
  ArrivalBucket,
} from "../utils/queueEstimate";

type Db = Prisma.TransactionClient;

export function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- Recording real stage timings ----------

// Call this every time a booking moves into a processing stage. It closes the
// previous stage's row and opens a new one, so we know how long each step really took.
export async function recordStageChange(
  db: Db,
  b: { id: string; farmerId: string; tokenNumber: number; crop: string; centreId: string },
  stage: ProcurementStage
): Promise<void> {
  try {
    const now = new Date();
    await db.queueStageHistory.updateMany({
      where: { bookingId: b.id, status: "IN_PROGRESS" },
      data: { completedAt: now, status: "DONE" },
    });
    await db.queueStageHistory.create({
      data: {
        bookingId: b.id,
        farmerId: b.farmerId,
        centreId: b.centreId,
        cropName: b.crop,
        tokenNumber: b.tokenNumber,
        stage,
        startedAt: now,
        completedAt: stage === "COMPLETED" ? now : null,
        status: stage === "COMPLETED" ? "DONE" : "IN_PROGRESS",
      },
    });
  } catch (err) {
    // Timing data is a bonus; it must never block the real work.
    console.error("recordStageChange failed:", err);
  }
}

// ---------- Measured statistics ----------

export interface CentreStats {
  service: ServiceTime;
  showUpRate: number;
  showUpBasis: "MEASURED" | "BASELINE";
}

export async function centreStats(centre: Pick<ProcurementCentre, "id" | "avgProcessingMin">): Promise<CentreStats> {
  const cfg = queueConfig();
  const since = new Date(Date.now() - cfg.rollingDays * DAY_MS);

  const done = await prisma.queueStageHistory.findMany({
    where: { centreId: centre.id, stage: "COMPLETED", startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: cfg.rollingSamples,
    select: { bookingId: true, startedAt: true },
  });
  let samples: number[] = [];
  if (done.length > 0) {
    const arrived = await prisma.queueStageHistory.findMany({
      where: { bookingId: { in: done.map((d) => d.bookingId) }, stage: "ARRIVED" },
      select: { bookingId: true, startedAt: true },
    });
    const arrivedAt = new Map(arrived.map((a) => [a.bookingId, a.startedAt.getTime()]));
    samples = done
      .map((d) => (arrivedAt.has(d.bookingId) ? (d.startedAt.getTime() - arrivedAt.get(d.bookingId)!) / 60000 : NaN))
      .filter((m) => Number.isFinite(m));
  }
  const service = rollingServiceTime(samples, centre.avgProcessingMin, cfg);

  const today = todayUtc();
  const [completed, noShow] = await Promise.all([
    prisma.booking.count({ where: { status: "COMPLETED", slot: { centreId: centre.id, date: { gte: since, lt: today } } } }),
    prisma.booking.count({ where: { status: "NO_SHOW", slot: { centreId: centre.id, date: { gte: since, lt: today } } } }),
  ]);
  const total = completed + noShow;
  const measured = total >= cfg.minShowUpSamples;
  return {
    service,
    showUpRate: measured ? Math.max(0.3, completed / total) : cfg.baselineShowUpRate,
    showUpBasis: measured ? "MEASURED" : "BASELINE",
  };
}

// ---------- One centre's queue, with every farmer's estimate ----------

export interface QueueRow {
  bookingId: string;
  farmerId: string;
  tokenNumber: number;
  stage: Stage;
  farmersAhead: number;
  estimate: Estimate;
}

export interface CentreQueue {
  centreId: string;
  centreName: string;
  location: string;
  isActive: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  delayMinutes: number;
  delayNote: string | null;
  currentToken: number;
  counters: number;
  stats: CentreStats;
  expected: number; // booked, not arrived yet
  waiting: number; // arrived, waiting for verification
  processing: number; // being verified, checked or weighed
  completedToday: number;
  newArrivalWaitMin: number;
  newArrival: Estimate; // estimate for a farmer arriving right now
  level: QueueLevel;
  rows: QueueRow[];
}

export async function computeCentreQueue(centre: ProcurementCentre, date: Date = todayUtc()): Promise<CentreQueue> {
  const cfg = queueConfig();
  const [bookings, completedToday, stats] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "BOOKED", slot: { centreId: centre.id, date } },
      include: { queueEntry: true },
      orderBy: { tokenNumber: "asc" },
    }),
    prisma.booking.count({ where: { status: "COMPLETED", slot: { centreId: centre.id, date } } }),
    centreStats(centre),
  ]);
  const counters = effectiveCounters(centre.activeCounters, centre.numOperators, centre.numMachines);

  let expected = 0;
  let waiting = 0;
  let processing = 0;
  const rows: QueueRow[] = [];
  let workloadAhead = 0;
  let aheadCount = 0;
  for (const b of bookings) {
    const stage = (b.queueEntry?.stage ?? "SLOT_BOOKED") as Stage;
    if (stage === "COMPLETED") continue;
    const estimate = estimateWait({
      workloadMin: workloadAhead,
      counters,
      ownServiceMin: stats.service.minutes,
      delayMin: centre.delayMinutes,
      basis: stats.service.basis,
      spreadMeasured: cfg.spreadMeasured,
      spreadBaseline: cfg.spreadBaseline,
    });
    rows.push({ bookingId: b.id, farmerId: b.farmerId, tokenNumber: b.tokenNumber, stage, farmersAhead: aheadCount, estimate });
    // This farmer now counts as "ahead" for the next one. Farmers who have
    // not arrived yet are weighted by how many booked farmers really come.
    const weight = STAGE_REMAINING[stage] * (stage === "SLOT_BOOKED" ? stats.showUpRate : 1);
    workloadAhead += weight * stats.service.minutes;
    aheadCount += 1;
    if (stage === "SLOT_BOOKED") expected++;
    else if (stage === "ARRIVED") waiting++;
    else processing++;
  }
  const newArrivalWaitMin = workloadAhead / counters + centre.delayMinutes;
  return {
    centreId: centre.id,
    centreName: centre.name,
    location: `${centre.location}, ${centre.district}`,
    isActive: centre.isActive,
    isPaused: centre.isPaused,
    pauseReason: centre.pauseReason,
    delayMinutes: centre.delayMinutes,
    delayNote: centre.delayNote,
    currentToken: centre.currentToken,
    counters,
    stats,
    expected,
    waiting,
    processing,
    completedToday,
    newArrivalWaitMin: Math.round(newArrivalWaitMin),
    newArrival: estimateWait({
      workloadMin: workloadAhead,
      counters,
      ownServiceMin: stats.service.minutes,
      delayMin: centre.delayMinutes,
      basis: stats.service.basis,
      spreadMeasured: cfg.spreadMeasured,
      spreadBaseline: cfg.spreadBaseline,
    }),
    level: classifyCentre({
      paused: centre.isPaused || !centre.isActive,
      delayMin: centre.delayMinutes,
      newArrivalWaitMin,
      serviceMin: stats.service.minutes,
      baselineMin: centre.avgProcessingMin,
      basis: stats.service.basis,
      cfg,
    }),
    rows,
  };
}

// Compact public summary of a centre (no individual farmers).
export function centreSummary(q: CentreQueue) {
  return {
    centreId: q.centreId,
    centreName: q.centreName,
    location: q.location,
    isActive: q.isActive,
    isPaused: q.isPaused,
    pauseReason: q.pauseReason,
    delayMinutes: q.delayMinutes,
    currentToken: q.currentToken,
    waiting: q.waiting,
    expected: q.expected,
    processing: q.processing,
    completedToday: q.completedToday,
    counters: q.counters,
    avgProcessingMin: q.stats.service.minutes,
    basis: q.stats.service.basis,
    samples: q.stats.service.samples,
    level: q.level,
    // wait for someone arriving now, as a range
    newArrival: q.newArrival,
  };
}

export async function listCentreSummaries() {
  const centres = await prisma.procurementCentre.findMany({ orderBy: { name: "asc" } });
  const queues = await Promise.all(centres.filter((c) => c.isActive || c.isPaused).map((c) => computeCentreQueue(c)));
  return queues.map(centreSummary);
}

// ---------- A farmer's own view ----------

export async function farmerQueueView(userId: string) {
  const farmer = await prisma.farmer.findUnique({ where: { userId } });
  if (!farmer) return null;
  const booking = await prisma.booking.findFirst({
    where: { farmerId: farmer.id, status: "BOOKED" },
    include: { slot: { include: { centre: true } }, queueEntry: true },
    orderBy: [{ slot: { date: "asc" } }, { createdAt: "desc" }],
  });
  if (!booking) return { hasBooking: false as const };

  const centre = booking.slot.centre;
  const isToday = booking.slot.date.getTime() === todayUtc().getTime();
  const q = await computeCentreQueue(centre, booking.slot.date);
  const own = q.rows.find((r) => r.bookingId === booking.id) ?? null;
  return {
    hasBooking: true as const,
    isToday,
    bookingId: booking.id,
    centreId: centre.id,
    centreName: centre.name,
    date: booking.slot.date,
    slotStart: booking.slot.startTime,
    slotEnd: booking.slot.endTime,
    yourToken: booking.tokenNumber,
    stage: (booking.queueEntry?.stage ?? "SLOT_BOOKED") as Stage,
    currentToken: centre.currentToken,
    farmersAhead: own?.farmersAhead ?? 0,
    waiting: q.waiting,
    processing: q.processing,
    level: q.level,
    isPaused: q.isPaused,
    pauseReason: q.pauseReason,
    delayMinutes: q.delayMinutes,
    delayNote: q.delayNote,
    avgProcessingMin: q.stats.service.minutes,
    counters: q.counters,
    estimate: own?.estimate ?? null,
    generatedAt: new Date().toISOString(),
  };
}

// ---------- Look ahead (officers) ----------

function localNow(): { hour: number; minute: number } {
  const t = new Date(Date.now() + emergencyConfig().centreUtcOffsetMinutes * 60_000);
  return { hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}

export async function congestionForecast(centre: ProcurementCentre) {
  const cfg = queueConfig();
  const q = await computeCentreQueue(centre);
  const today = todayUtc();
  const now = localNow();

  // Who is still expected today, grouped by the hour of their slot.
  const pending = await prisma.booking.findMany({
    where: { status: "BOOKED", slot: { centreId: centre.id, date: today }, queueEntry: { stage: "SLOT_BOOKED" } },
    include: { slot: true },
  });
  const byHour = new Map<number, number>();
  for (const b of pending) {
    const h = parseInt(b.slot.startTime.split(":")[0], 10);
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  const buckets: ArrivalBucket[] = [...byHour].map(([hour, expectedArrivals]) => ({ hour, expectedArrivals }));
  const endHour = Math.max(now.hour + 1, parseInt(centre.operatingEnd.split(":")[0], 10) || 17);

  const hours = predictCongestion({
    startQueue: q.waiting + q.processing * 0.5,
    nowHour: Math.min(now.hour, endHour - 1),
    nowMinute: now.minute,
    endHour,
    buckets,
    showUpRate: q.stats.showUpRate,
    serviceMin: q.stats.service.minutes,
    counters: q.counters,
    delayMin: centre.delayMinutes,
    cfg,
  });
  const worst = hours.reduce<"NORMAL" | "MODERATE" | "HIGH">(
    (w, h) => (h.level === "HIGH" || w === "HIGH" ? "HIGH" : h.level === "MODERATE" || w === "MODERATE" ? "MODERATE" : "NORMAL"),
    "NORMAL"
  );
  const delayRisk = hours.some((h) => h.delayRisk);
  const expectedTotal = Math.round(hours.reduce((a, h) => a + h.expectedArrivals, 0) * 10) / 10;
  const peak = hours.reduce((m, h) => (h.predictedQueue > m ? h.predictedQueue : m), 0);

  // Which step is the slowest, from real timings (needs a few finished farmers).
  const since = new Date(Date.now() - cfg.rollingDays * DAY_MS);
  const dwell = await prisma.queueStageHistory.findMany({
    where: { centreId: centre.id, status: "DONE", stage: { in: ["ARRIVED", "VERIFIED", "QUALITY_CHECKED", "WEIGHED"] }, startedAt: { gte: since } },
    select: { stage: true, startedAt: true, completedAt: true },
  });
  const sums = new Map<string, { total: number; n: number }>();
  for (const d of dwell) {
    if (!d.completedAt) continue;
    const m = (d.completedAt.getTime() - d.startedAt.getTime()) / 60000;
    if (m < cfg.sampleMinMinutes || m > cfg.sampleMaxMinutes) continue;
    const s = sums.get(d.stage) ?? { total: 0, n: 0 };
    s.total += m;
    s.n += 1;
    sums.set(d.stage, s);
  }
  let slowest: { stage: string; avgMin: number; samples: number } | null = null;
  for (const [stage, s] of sums) {
    if (s.n < cfg.minSamples) continue;
    const avg = s.total / s.n;
    if (!slowest || avg > slowest.avgMin) slowest = { stage, avgMin: Math.round(avg * 10) / 10, samples: s.n };
  }
  // Where farmers are piled up right now.
  const counts = new Map<string, number>();
  for (const r of q.rows) if (r.stage !== "SLOT_BOOKED") counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  let backlog: { stage: string; count: number } | null = null;
  for (const [stage, count] of counts) if (count >= 3 && (!backlog || count > backlog.count)) backlog = { stage, count };

  const workload = Math.round(q.rows.reduce((a, r) => a + STAGE_REMAINING[r.stage] * (r.stage === "SLOT_BOOKED" ? q.stats.showUpRate : 1), 0) * q.stats.service.minutes);
  const utilization = Math.round(((q.waiting + q.processing) / Math.max(1, q.counters)) * 100);

  return {
    centreId: centre.id,
    centreName: centre.name,
    level: q.level,
    isPaused: q.isPaused,
    pauseReason: q.pauseReason,
    delayMinutes: q.delayMinutes,
    delayNote: q.delayNote,
    activeCountersSetting: centre.activeCounters, // null = worked out from staff and machines
    currentQueue: q.waiting + q.processing,
    waiting: q.waiting,
    processing: q.processing,
    expectedArrivals: expectedTotal,
    predictedPeakQueue: peak,
    estimatedWorkloadMin: workload,
    counters: q.counters,
    counterUtilizationPct: utilization,
    avgProcessingMin: q.stats.service.minutes,
    basis: q.stats.service.basis,
    samples: q.stats.service.samples,
    showUpRate: Math.round(q.stats.showUpRate * 100),
    showUpBasis: q.stats.showUpBasis,
    outlook: delayRisk && worst === "NORMAL" ? "DELAY_RISK" : worst,
    hours,
    slowestStage: slowest,
    backlogStage: backlog,
    method: "BASELINE_SIMULATION" as const,
    generatedAt: new Date().toISOString(),
  };
}

// ---------- Centre status changes by staff ----------

export async function notifyTodaysFarmers(
  centreId: string,
  type: NotificationType,
  message: string,
  params: Record<string, string | number>,
  withSms: boolean
) {
  const bookings = await prisma.booking.findMany({
    where: { status: "BOOKED", slot: { centreId, date: todayUtc() }, queueEntry: { stage: { not: "COMPLETED" } } },
    include: { farmer: { include: { user: true } } },
  });
  for (const b of bookings) {
    await notifyFarmer(b.farmerId, type, message, params);
    if (withSms) void sendSms(b.farmer.user.mobile, message);
  }
}

export function emitQueueChanged(centreId: string) {
  try {
    getIO().to(`centre:${centreId}`).emit("queue-updated", { centreId });
  } catch {
    /* live update is a bonus */
  }
}

// ---------- Delay notifications ----------

// Looks at every waiting farmer's estimate and tells them only when it moved
// a lot and they have not been told recently. Called by the background job.
export async function sweepQueueNotifications(): Promise<number> {
  const cfg = queueConfig();
  const today = todayUtc();
  const centres = await prisma.procurementCentre.findMany({
    where: { isActive: true, slots: { some: { date: today, bookings: { some: { status: "BOOKED" } } } } },
  });
  let sent = 0;
  for (const centre of centres) {
    if (centre.isPaused) continue; // pause has its own message
    const q = await computeCentreQueue(centre, today);
    for (const r of q.rows) {
      if (r.stage === "COMPLETED") continue;
      const mid = Math.round((r.estimate.startLowMin + r.estimate.startHighMin) / 2);
      const state = await prisma.queueNotificationState.findUnique({ where: { bookingId: r.bookingId } });
      if (!state || state.lastEtaMin === null) {
        await prisma.queueNotificationState.upsert({
          where: { bookingId: r.bookingId },
          create: { bookingId: r.bookingId, lastEtaMin: mid },
          update: { lastEtaMin: mid },
        });
        continue;
      }
      const last = state.lastEtaMin;
      const rise = mid - last;
      const threshold = Math.max(cfg.notifyMinChangeMin, last * cfg.notifyMinChangePct);
      const cooled = !state.lastNotifiedAt || Date.now() - state.lastNotifiedAt.getTime() >= cfg.notifyCooldownMin * 60_000;
      if (rise >= threshold && cooled) {
        await notifyFarmer(
          r.farmerId,
          "queueDelayed",
          `Your waiting time has increased: now about ${r.estimate.startLowMin}-${r.estimate.startHighMin} minutes.`,
          { low: r.estimate.startLowMin, high: r.estimate.startHighMin, token: r.tokenNumber }
        );
        await prisma.queueNotificationState.update({ where: { bookingId: r.bookingId }, data: { lastEtaMin: mid, lastNotifiedAt: new Date() } });
        sent++;
      } else if (rise <= -threshold) {
        // Good news is not worth a message, but we remember it so a later rise is measured from here.
        await prisma.queueNotificationState.update({ where: { bookingId: r.bookingId }, data: { lastEtaMin: mid } });
      }
    }
  }
  return sent;
}
