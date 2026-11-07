// Shared building blocks for emergency cancellation: the "is a request open?"
// check, request numbers, the weather check, and live-update helpers.

import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prismaClient";
import { getIO } from "../socket";
import { emergencyConfig } from "../config/emergency";
import { fetchWeather, geocodePlace } from "./weather/providers";
import { GeoPoint, WeatherFetchResult } from "./weather/types";
import { evaluateClaim, Category } from "./emergencyVerification";
import { notifyFarmer } from "./notificationService";

type Db = Prisma.TransactionClient | typeof prisma;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const OPEN_STATUSES = ["SUBMITTED", "UNDER_VERIFICATION", "AWAITING_REVIEW"] as const;

// While a request is open, the booking must stay exactly as it is, so normal
// cancel / change time / change weight / no-show are paused for it.
export async function hasOpenEmergency(db: Db, bookingId: string): Promise<boolean> {
  const found = await db.emergencyRequest.findFirst({
    where: { bookingId, status: { in: [...OPEN_STATUSES] } },
    select: { id: true },
  });
  return found !== null;
}

export const OPEN_EMERGENCY_MESSAGE =
  "You have an emergency request in progress for this booking, so it can't be changed until a decision is made.";

// "EMR-2026-000012": highest existing number + 1 (the column is unique, so a
// rare clash fails cleanly instead of creating a duplicate).
export async function nextRequestNo(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `EMR-${year}-`;
  const last = await tx.emergencyRequest.findFirst({
    where: { requestNo: { startsWith: prefix } },
    orderBy: { requestNo: "desc" },
    select: { requestNo: true },
  });
  const n = last ? parseInt(last.requestNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(6, "0")}`;
}

// Slot times are local ("09:00"); the weather lookup needs real UTC moments.
export function slotTimesMs(slotDate: Date, start: string, end: string): { startMs: number; endMs: number } {
  const offset = emergencyConfig().centreUtcOffsetMinutes * 60_000;
  const base = Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate());
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return { startMs: base + minutes(start) * 60_000 - offset, endMs: base + minutes(end) * 60_000 - offset };
}

export function roundCoord(n: number): number {
  return Math.round(n * 100) / 100; // about 1 km: enough for weather, too coarse to find a house
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// The centre's map position: saved, or looked up once from its district name
// and then saved so it is never looked up again.
async function centreCoordinates(centre: {
  id: string;
  district: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<{ lat: number; lng: number } | null> {
  if (centre.latitude !== null && centre.longitude !== null) return { lat: centre.latitude, lng: centre.longitude };
  const found = await geocodePlace(centre.district, centre.state);
  if (!found) return null;
  await prisma.procurementCentre
    .update({ where: { id: centre.id }, data: { latitude: found.lat, longitude: found.lng } })
    .catch(() => undefined);
  return found;
}

// Places to look at: the farmer's reported place and a point halfway to the
// centre (the likely route), the centre itself, and, if the farmer shared no
// place, four points about 10 km around the centre.
function buildPoints(centre: { lat: number; lng: number }, farmer: { lat: number; lng: number } | null): GeoPoint[] {
  const points: GeoPoint[] = [];
  if (farmer) {
    points.push({ label: "farmer", lat: farmer.lat, lng: farmer.lng });
    points.push({ label: "centre", lat: centre.lat, lng: centre.lng });
    points.push({ label: "route", lat: (farmer.lat + centre.lat) / 2, lng: (farmer.lng + centre.lng) / 2 });
  } else {
    points.push({ label: "centre", lat: centre.lat, lng: centre.lng });
    const dLat = 0.09;
    const dLng = 0.09 / Math.max(0.2, Math.cos((centre.lat * Math.PI) / 180));
    points.push({ label: "area", lat: centre.lat + dLat, lng: centre.lng });
    points.push({ label: "area", lat: centre.lat - dLat, lng: centre.lng });
    points.push({ label: "area", lat: centre.lat, lng: centre.lng + dLng });
    points.push({ label: "area", lat: centre.lat, lng: centre.lng - dLng });
  }
  return points;
}

// Tells open screens (the farmer's and the centre's officers') to reload.
export function emitEmergencyUpdated(req: { id: string; status: string; centreId: string }, farmerUserId: string) {
  try {
    const io = getIO();
    io.to(`user:${farmerUserId}`).emit("emergency-updated", { requestId: req.id, status: req.status });
    io.to(`centre:${req.centreId}`).emit("emergency-updated", { requestId: req.id, status: req.status });
  } catch {
    /* live update is a bonus */
  }
}

export function emitCapacityChanged(centreId: string) {
  try {
    getIO().to(`centre:${centreId}`).emit("capacity-updated", { centreId });
  } catch {
    /* live update is a bonus */
  }
}

// Runs the weather + evidence check for one request and moves it to "Awaiting
// officer review". It NEVER approves or rejects, and it never leaves a request
// stuck: if anything goes wrong the request still reaches an officer, marked
// "unable to verify". Safe to run again (an officer can re-run it).
export async function runVerification(requestId: string, triggeredByUserId?: string): Promise<void> {
  try {
    const moved = await prisma.emergencyRequest.updateMany({
      where: { id: requestId, status: { in: [...OPEN_STATUSES] } },
      data: { status: "UNDER_VERIFICATION" },
    });
    if (moved.count === 0) return;

    const r = await prisma.emergencyRequest.findUnique({
      where: { id: requestId },
      include: { farmer: { select: { id: true, userId: true } }, centre: true, _count: { select: { evidence: true } } },
    });
    if (!r) return;
    emitEmergencyUpdated({ id: r.id, status: "UNDER_VERIFICATION", centreId: r.centreId }, r.farmer.userId);

    const slot = slotTimesMs(r.slotDate, r.slotStart, r.slotEnd);
    const incidentMs = r.incidentAt.getTime();
    let startMs = Math.min(incidentMs, slot.startMs) - 6 * HOUR;
    const endMs = Math.max(incidentMs, slot.startMs) + 3 * HOUR;
    if (endMs - startMs > 3 * DAY) startMs = endMs - 3 * DAY;

    const centrePos = await centreCoordinates(r.centre);
    const farmerPos = r.affectedLat !== null && r.affectedLng !== null ? { lat: r.affectedLat, lng: r.affectedLng } : null;

    let weather: WeatherFetchResult;
    if (!centrePos) {
      weather = {
        provider: emergencyConfig().provider,
        source: "UNAVAILABLE",
        dataKind: "NONE",
        note: "The centre's map position could not be found, so no weather lookup was possible.",
        points: [],
      };
    } else {
      weather = await fetchWeather(buildPoints(centrePos, farmerPos), startMs, endMs);
    }

    const previousClaims = await prisma.emergencyRequest.count({
      where: { farmerId: r.farmerId, id: { not: r.id }, createdAt: { gte: new Date(Date.now() - 90 * DAY) } },
    });
    const result = evaluateClaim({
      category: r.category as Category,
      windowStartMs: startMs,
      windowEndMs: endMs,
      nowMs: Date.now(),
      hasFarmerLocation: farmerPos !== null,
      evidenceCount: r._count.evidence,
      descriptionLength: r.description.length,
      weather,
      previousClaims,
    });

    // A reported place very far from the centre is worth a second look.
    const flags = result.flagReason ? result.flagReason.split(",") : [];
    if (farmerPos && centrePos) {
      const km = Math.round(distanceKm(farmerPos, centrePos));
      if (km > 250) {
        flags.push("farFromCentre");
        result.reasons.push({ code: "farFromCentre", params: { km } });
      }
    }

    await prisma.weatherVerification.create({
      data: {
        requestId: r.id,
        provider: weather.provider,
        source: weather.source,
        windowStart: new Date(startMs),
        windowEnd: new Date(endMs),
        outcome: result.outcome,
        supportScore: result.supportScore,
        reasons: result.reasons as unknown as Prisma.InputJsonArray,
        observations: { note: weather.note ?? null, dataKind: weather.dataKind, points: result.observations } as unknown as Prisma.InputJsonObject,
        triggeredByUserId: triggeredByUserId ?? null,
      },
    });

    const newFlags = [...new Set([...(r.flagReason ? r.flagReason.split(",") : []), ...flags])];
    await prisma.emergencyRequest.updateMany({
      where: { id: r.id, status: "UNDER_VERIFICATION" },
      data: {
        status: "AWAITING_REVIEW",
        outcome: result.outcome,
        supportScore: result.supportScore,
        flagged: r.flagged || newFlags.length > 0,
        flagReason: newFlags.length ? newFlags.join(",") : null,
      },
    });

    await notifyFarmer(
      r.farmer.id,
      "emergencyVerified",
      `The weather and evidence check for request ${r.requestNo} is finished. An officer will now review it.`,
      { requestNo: r.requestNo }
    );
    emitEmergencyUpdated({ id: r.id, status: "AWAITING_REVIEW", centreId: r.centreId }, r.farmer.userId);
  } catch (err) {
    console.error("runVerification failed:", err);
    // Never leave the farmer waiting on a broken check: hand it to an officer.
    try {
      const r = await prisma.emergencyRequest.findUnique({ where: { id: requestId }, include: { farmer: { select: { userId: true } } } });
      if (r && (r.status === "UNDER_VERIFICATION" || r.status === "SUBMITTED")) {
        await prisma.weatherVerification.create({
          data: {
            requestId,
            provider: emergencyConfig().provider,
            source: "UNAVAILABLE",
            windowStart: new Date(),
            windowEnd: new Date(),
            outcome: "UNABLE_TO_VERIFY",
            supportScore: 0,
            reasons: [{ code: "verificationError" }] as unknown as Prisma.InputJsonArray,
            observations: { note: null, dataKind: "NONE", points: [] } as unknown as Prisma.InputJsonObject,
            triggeredByUserId: triggeredByUserId ?? null,
          },
        });
        await prisma.emergencyRequest.update({
          where: { id: requestId },
          data: { status: "AWAITING_REVIEW", outcome: "UNABLE_TO_VERIFY", supportScore: 0 },
        });
        emitEmergencyUpdated({ id: r.id, status: "AWAITING_REVIEW", centreId: r.centreId }, r.farmer.userId);
      }
    } catch (inner) {
      console.error("runVerification fallback failed:", inner);
    }
  }
}
