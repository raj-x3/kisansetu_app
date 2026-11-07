import { useCallback, useEffect, useState, ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { TimelineModal } from "../components/TimelineModal";
import { RescheduleModal } from "../components/RescheduleModal";
import { ChangeWeightModal } from "../components/ChangeWeightModal";
import { QrCode } from "../components/QrCode";
import { EmergencyModal } from "../components/EmergencyModal";
import { EmergencyStatusCard } from "../components/EmergencyStatusCard";
import { LiveQueuePanel } from "../components/LiveQueuePanel";
import { WaitlistPanel } from "../components/WaitlistPanel";
import { FarmerProfile, FarmerBooking, ProcurementStage } from "../types";
import { ProcessChain } from "../components/ProcessChain";
import { useLanguage } from "../context/LanguageContext";

function buildJourney(t: (key: any) => string): { key: ProcurementStage; label: string }[] {
  return [
    { key: "REGISTERED", label: t("stage.registered") },
    { key: "SLOT_BOOKED", label: t("stage.slotBooked") },
    { key: "ARRIVED", label: t("stage.arrived") },
    { key: "VERIFIED", label: t("stage.verified") },
    { key: "QUALITY_CHECKED", label: t("stage.qualityCheck") },
    { key: "WEIGHED", label: t("stage.weighed") },
    { key: "COMPLETED", label: t("stage.completed") },
  ];
}

type CrowdLevel = "LOW" | "MEDIUM" | "HIGH";

interface QueuePosition {
  hasBooking: boolean;
  centreId?: string;
  centreName?: string;
  currentToken?: number;
  yourToken?: number;
  farmersAhead?: number;
  crowdLevel?: CrowdLevel;
  centreCapacity?: number;
}

function computeCrowdLevel(farmersAhead: number, capacity: number): CrowdLevel {
  const ratio = farmersAhead / Math.max(capacity, 1);
  if (ratio < 1.5) return "LOW";
  if (ratio < 4) return "MEDIUM";
  return "HIGH";
}

export function FarmerDashboard() {
  const { t } = useLanguage();
  const JOURNEY = buildJourney(t);
  const [profile, setProfile] = useState<FarmerProfile | null>(null);
  const [booking, setBooking] = useState<FarmerBooking | null>(null);
  const [queue, setQueue] = useState<QueuePosition | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showWeight, setShowWeight] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergencyKey, setEmergencyKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Reloads the active booking and queue (used after an emergency decision or a new slot).
  const refreshBooking = useCallback(() => {
    Promise.all([api.get("/bookings/my"), api.get("/queue/my-position")])
      .then(([bookingsRes, queueRes]) => {
        const active = bookingsRes.data.find((b: FarmerBooking) => b.status === "BOOKED");
        setBooking(active ?? null);
        setQueue(queueRes.data);
      })
      .catch(() => undefined);
  }, []);

  async function cancelMyBooking() {
    if (!booking || !window.confirm(t("booking.cancelConfirm"))) return;
    setError(null);
    try {
      await api.post(`/bookings/${booking.id}/cancel`);
      setBooking(null);
      setQueue({ hasBooking: false } as QueuePosition);
      setNotice(t("booking.cancelled"));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  // Load the initial state once.
  useEffect(() => {
    Promise.all([api.get("/farmers/me"), api.get("/bookings/my"), api.get("/queue/my-position")])
      .then(([profileRes, bookingsRes, queueRes]) => {
        setProfile(profileRes.data);
        const active = bookingsRes.data.find((b: FarmerBooking) => b.status === "BOOKED");
        setBooking(active ?? null);
        setQueue(queueRes.data);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  // Once we know which centre this farmer's booking belongs to, join
  // that centre's real-time room, and update the queue card the
  // instant the operator calls the next farmer — no page refresh.
  useEffect(() => {
    if (!queue?.centreId) return;

    socket.emit("join-centre", queue.centreId);

    function handleUpdate(payload: { centreId: string; currentToken: number }) {
      if (payload.centreId !== queue?.centreId) return;
      setQueue((prev) => {
        if (!prev || prev.yourToken === undefined) return prev;
        const farmersAhead = Math.max(0, prev.yourToken - payload.currentToken - 1);
        const crowdLevel = computeCrowdLevel(farmersAhead, prev.centreCapacity ?? 1);
        return { ...prev, currentToken: payload.currentToken, farmersAhead, crowdLevel };
      });
    }

    // Each step's broadcast carries its own extra details (quality
    // result, net weight, amount + bill reference, initial payment
    // status) — merge whichever ones are present so every badge on the
    // dashboard updates live, not just the stage.
    function handleStageUpdate(payload: {
      centreId: string;
      bookingId: string;
      stage: string;
      status?: string;
      qualityResult?: FarmerBooking["qualityResult"];
      netWeightKg?: number;
      totalAmount?: number;
      billReference?: string;
      paymentStatus?: FarmerBooking["paymentStatus"];
    }) {
      if (payload.centreId !== queue?.centreId) return;
      setBooking((prev) => {
        if (!prev || prev.id !== payload.bookingId) return prev;
        // Cancelled, or marked as a no-show by the centre: no longer an active booking.
        if (payload.status === "NO_SHOW" || payload.status === "CANCELLED") return null;
        return {
          ...prev,
          stage: payload.stage as FarmerBooking["stage"],
          qualityResult: payload.qualityResult ?? prev.qualityResult,
          netWeightKg: payload.netWeightKg ?? prev.netWeightKg,
          totalAmount: payload.totalAmount ?? prev.totalAmount,
          billReference: payload.billReference ?? prev.billReference,
          paymentStatus: payload.paymentStatus ?? prev.paymentStatus,
        };
      });
    }

    function handlePaymentUpdate(payload: {
      centreId: string;
      bookingId: string;
      paymentStatus: FarmerBooking["paymentStatus"];
    }) {
      if (payload.centreId !== queue?.centreId) return;
      setBooking((prev) => {
        if (!prev || prev.id !== payload.bookingId) return prev;
        return { ...prev, paymentStatus: payload.paymentStatus };
      });
    }

    socket.on("queue-updated", handleUpdate);
    socket.on("stage-updated", handleStageUpdate);
    socket.on("payment-updated", handlePaymentUpdate);
    return () => {
      socket.off("queue-updated", handleUpdate);
      socket.off("stage-updated", handleStageUpdate);
      socket.off("payment-updated", handlePaymentUpdate);
    };
  }, [queue?.centreId]);

  // Ask the AI ETA service for a fresh estimate whenever the farmer's
  // live queue position changes — a shrinking queue should mean a
  // shrinking estimate, without the farmer needing to do anything.
  useEffect(() => {
    if (!queue?.hasBooking) return;
    setEtaLoading(true);
    api
      .get("/ml/predict-eta")
      .then((res) => setEtaMinutes(res.data.predictedWaitingMinutes))
      .catch(() => setEtaMinutes(null))
      .finally(() => setEtaLoading(false));
  }, [queue?.hasBooking, queue?.farmersAhead]);

  if (loading) {
    return <p className="mx-auto max-w-5xl px-4 py-12 text-soil-light">{t("common.loadingDashboard")}</p>;
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error || t("farmer.loadFail")}
        </div>
      </div>
    );
  }

  const currentStageIndex = booking ? JOURNEY.findIndex((j) => j.key === booking.stage) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">
            {t("dashboard.welcome")}, {profile.fullName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-soil-light">{t("dashboard.farmerId")}: {profile.farmerCode}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/farmer/history" className="text-sm font-semibold text-field underline">
            {t("history.link")}
          </Link>
          {!booking && (
            <Link to="/farmer/book-slot" className="btn-primary">
              {t("dashboard.bookSlot")}
            </Link>
          )}
        </div>
      </div>

      {/* Summary cards — Queue Position now updates live, in real time. */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={t("dashboard.currentBooking")}
          value={booking ? booking.centreName : t("farmer.noneYet")}
          hint={booking ? `${booking.startTime}–${booking.endTime}` : t("farmer.bookToStart")}
        />
        <SummaryCard
          label={t("dashboard.tokenNumber")}
          value={booking ? String(booking.tokenNumber) : "—"}
          hint={booking ? `${booking.crop} · ${booking.caseId}` : t("farmer.assignedAfter")}
        />
        <SummaryCard
          label={t("dashboard.queuePosition")}
          value={queue?.hasBooking ? t("farmer.ahead").replace("{n}", String(queue.farmersAhead)) : "—"}
          hint={
            queue?.hasBooking
              ? t("farmer.nowServingLive").replace("{token}", String(queue.currentToken))
              : t("farmer.shownOnceActive")
          }
          live={queue?.hasBooking}
          badge={queue?.hasBooking && queue.crowdLevel ? <CrowdBadge level={queue.crowdLevel} /> : undefined}
        />
        <SummaryCard
          label={t("dashboard.aiWaitTime")}
          value={
            !queue?.hasBooking
              ? "—"
              : etaLoading
              ? "…"
              : etaMinutes !== null
              ? t("farmer.minutes").replace("{n}", String(Math.round(etaMinutes)))
              : "—"
          }
          hint={
            !queue?.hasBooking
              ? t("farmer.shownOnceActive")
              : etaMinutes !== null
              ? t("farmer.aiEstimateNote")
              : t("farmer.estimateUnavailable")
          }
          live={queue?.hasBooking && etaMinutes !== null}
        />
      </div>

      <div className="mt-8 card">
        <h2 className="font-display text-lg font-semibold text-soil">{t("farmer.procStatusTitle")}</h2>
        <div className="mt-4">
          <ProcessChain
            stages={JOURNEY.map((j) => j.label)}
            currentIndex={Math.max(currentStageIndex, 0)}
          />
        </div>
        {!booking && (
          <p className="mt-4 text-sm text-soil-light">
            {t("farmer.registeredBook")}
          </p>
        )}
        {booking && (
          <p className="mt-4 text-sm text-soil-light">
            {t("farmer.bookedFor")
              .replace("{date}", new Date(booking.date).toLocaleDateString())
              .replace("{kg}", String(booking.quantityKg))
              .replace("{crop}", booking.crop)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {booking?.qualityResult && (
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
                booking.qualityResult === "ACCEPTED" ? "bg-field/10 text-field" : "bg-red-50 text-red-600"
              }`}
            >
              {t(booking.qualityResult === "ACCEPTED" ? "quality.accepted" : "quality.rejected")}
            </span>
          )}
          {booking?.netWeightKg !== null &&
            booking?.netWeightKg !== undefined &&
            !booking?.totalAmount && (
              <span className="inline-block rounded-full bg-sky/10 px-3 py-1 text-sm font-semibold text-sky">
                {t("weigh.netWeightBadge")}: {booking.netWeightKg} kg
              </span>
            )}
          {booking?.totalAmount !== null && booking?.totalAmount !== undefined && (
            <span className="inline-block rounded-full bg-field/10 px-3 py-1 text-sm font-semibold text-field">
              {t("complete.badge")}: ₹{booking.totalAmount} · {booking.billReference}
            </span>
          )}
          {booking?.paymentStatus && (
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
                booking.paymentStatus === "CREDITED"
                  ? "bg-field text-paper"
                  : booking.paymentStatus === "FAILED"
                  ? "bg-red-50 text-red-600"
                  : "bg-wheat-light/40 text-soil"
              }`}
            >
              {t(
                ({
                  PENDING: "payment.pending",
                  INITIATED: "payment.initiated",
                  PROCESSING: "payment.processing",
                  CREDITED: "payment.credited",
                  FAILED: "payment.failed",
                } as const)[booking.paymentStatus]
              )}
            </span>
          )}
        </div>
      </div>

      {notice && (
        <div className="mt-4 rounded-lg bg-field/10 px-4 py-3 text-sm font-semibold text-field">{notice}</div>
      )}

      {booking && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button className="text-sm font-semibold text-sky underline" onClick={() => setShowTimeline(true)}>
            {t("timeline.view")}
          </button>
          <button className="text-sm font-semibold text-field underline" onClick={() => setShowQr((v) => !v)}>
            {showQr ? t("qr.hide") : t("qr.show")}
          </button>
          {booking.stage === "SLOT_BOOKED" && (
            <>
              <button className="text-sm font-semibold text-field underline" onClick={() => setShowReschedule(true)}>
                {t("booking.change")}
              </button>
              <button className="text-sm font-semibold text-field underline" onClick={() => setShowWeight(true)}>
                {t("cap.changeWeight")}
              </button>
              <button className="text-sm font-semibold text-red-600 underline" onClick={cancelMyBooking}>
                {t("booking.cancel")}
              </button>
              <button className="text-sm font-semibold text-red-600 underline" onClick={() => setShowEmergency(true)}>
                {t("emg.button")}
              </button>
            </>
          )}
        </div>
      )}
      {showEmergency && booking && (
        <EmergencyModal
          booking={booking}
          onClose={() => setShowEmergency(false)}
          onSent={() => {
            setShowEmergency(false);
            setNotice(t("emg.sent"));
            setEmergencyKey((k) => k + 1);
          }}
        />
      )}
      {showQr && booking && (
        <div className="mt-4 inline-block rounded-2xl border border-soil-light/20 bg-white p-4 text-center">
          <p className="font-display text-sm font-semibold text-soil">{t("qr.title")}</p>
          <div className="mt-3 flex justify-center">
            <QrCode value={booking.caseId} size={180} />
          </div>
          <p className="mt-2 text-xs font-semibold text-soil">{booking.caseId}</p>
          <p className="mt-1 max-w-[220px] text-xs text-soil-light">{t("qr.hint")}</p>
        </div>
      )}
      {showWeight && booking && (
        <ChangeWeightModal
          booking={booking}
          onClose={() => setShowWeight(false)}
          onChanged={(newKg) => {
            setBooking((prev) => (prev ? { ...prev, quantityKg: newKg } : prev));
            setShowWeight(false);
            setNotice(t("cap.weightChanged"));
          }}
        />
      )}
      {showReschedule && booking && (
        <RescheduleModal
          booking={booking}
          onClose={() => setShowReschedule(false)}
          onMoved={(u) => {
            setBooking((prev) => (prev ? { ...prev, tokenNumber: u.tokenNumber, date: u.date, startTime: u.startTime, endTime: u.endTime } : prev));
            api.get("/queue/my-position").then((r) => setQueue(r.data)).catch(() => undefined);
            setShowReschedule(false);
            setNotice(t("booking.moved"));
          }}
        />
      )}
      {showTimeline && booking && <TimelineModal bookingId={booking.id} onClose={() => setShowTimeline(false)} />}

      <EmergencyStatusCard reloadKey={emergencyKey} onBookingChanged={refreshBooking} />

      <WaitlistPanel onBookingChanged={refreshBooking} reloadKey={emergencyKey} />

      <LiveQueuePanel />
      {booking && <DocumentsPanel bookingId={booking.id} stage={booking.stage} />}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-soil">{t("dashboard.yourDetails")}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label={t("farmer.labelMobile")} value={profile.mobile} />
            <Row label={t("farmer.labelAddress")} value={profile.address} />
            <Row label={t("farmer.labelDistrict")} value={profile.district} />
            <Row label={t("farmer.labelState")} value={profile.state} />
            <Row label={t("farmer.labelPreferredCentre")} value={profile.preferredCentre || t("farmer.notSet")} />
          </dl>
        </div>

        <div className="card flex flex-col items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-soil">
              {booking ? t("farmer.aiWaitTitle") : t("farmer.readyToBook")}
            </h2>
            <p className="mt-2 text-sm text-soil-light">
              {booking
                ? t("farmer.aiWaitBody")
                : t("farmer.bookBody")}
            </p>
          </div>
          {!booking && (
            <Link to="/farmer/book-slot" className="btn-primary mt-4">
              {t("dashboard.bookSlot")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  live,
  badge,
}: {
  label: string;
  value: string;
  hint: string;
  live?: boolean;
  badge?: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-soil-light">{label}</p>
        {live && (
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase text-field">
            <span className="h-1.5 w-1.5 rounded-full bg-field" /> {t("dashboard.live")}
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-field">{value}</p>
      <p className="mt-1 text-xs text-soil-light">{hint}</p>
      {badge && <div className="mt-2">{badge}</div>}
    </div>
  );
}

// A small, honest congestion indicator — colour-coded, translated, and
// driven by the real crowdLevel the backend computed from actual queue
// length vs. this specific centre's actual processing capacity.
function CrowdBadge({ level }: { level: "LOW" | "MEDIUM" | "HIGH" }) {
  const { t } = useLanguage();
  const config = {
    LOW: { dot: "bg-field", text: "text-field", label: t("dashboard.crowdLow") },
    MEDIUM: { dot: "bg-wheat-dark", text: "text-wheat-dark", label: t("dashboard.crowdMedium") },
    HIGH: { dot: "bg-red-500", text: "text-red-600", label: t("dashboard.crowdHigh") },
  }[level];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${config.text}`}>
      <span className={`h-2 w-2 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-soil-light/10 pb-2">
      <dt className="text-soil-light">{label}</dt>
      <dd className="font-medium text-soil">{value}</dd>
    </div>
  );
}
