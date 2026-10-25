import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { FarmerBooking } from "../types";
import { TimelineModal } from "../components/TimelineModal";

const STAGE_KEY: Record<string, any> = {
  REGISTERED: "stage.registered",
  SLOT_BOOKED: "stage.slotBooked",
  ARRIVED: "stage.arrived",
  VERIFIED: "stage.verified",
  QUALITY_CHECKED: "stage.qualityCheck",
  WEIGHED: "stage.weighed",
  COMPLETED: "stage.completed",
};

const PAYMENT_KEY: Record<string, any> = {
  PENDING: "payment.pending",
  INITIATED: "payment.initiated",
  PROCESSING: "payment.processing",
  CREDITED: "payment.credited",
  FAILED: "payment.failed",
};

export function BookingHistory() {
  const { t } = useLanguage();
  const [bookings, setBookings] = useState<FarmerBooking[]>([]);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/bookings/my")
      .then((res) => setBookings(res.data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="mx-auto max-w-4xl px-4 py-12 text-soil-light">…</p>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("history.title")}</h1>
        <Link to="/farmer/dashboard" className="text-sm font-semibold text-field underline">
          {t("history.backToDashboard")}
        </Link>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!error && bookings.length === 0 && (
        <p className="mt-6 text-sm text-soil-light">{t("history.empty")}</p>
      )}

      <div className="mt-6 space-y-4">
        {bookings.map((b) => (
          <div key={b.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display font-semibold text-field">
                  {b.centreName} · {t("operator.tableToken")} {b.tokenNumber}
                </p>
                <p className="text-xs text-soil-light">
                  {t("case.id")}: {b.caseId}
                </p>
                <p className="text-xs text-soil-light">
                  {new Date(b.date).toLocaleDateString()} · {b.startTime}–{b.endTime} · {b.crop} ({b.quantityKg} kg)
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  b.status === "COMPLETED"
                    ? "bg-field/10 text-field"
                    : b.status === "CANCELLED" || b.status === "NO_SHOW"
                    ? "bg-red-50 text-red-600"
                    : "bg-soil-light/10 text-soil"
                }`}
              >
                {b.status === "CANCELLED"
                  ? t("booking.statusCancelled")
                  : b.status === "NO_SHOW"
                  ? t("booking.statusNoShow")
                  : t(STAGE_KEY[b.stage] ?? "stage.slotBooked")}
              </span>
            </div>

            {(b.qualityResult || b.netWeightKg !== null || b.totalAmount !== null || b.paymentStatus) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-soil-light/10 pt-3 text-xs">
                {b.qualityResult && (
                  <span className={b.qualityResult === "ACCEPTED" ? "text-field" : "text-red-600"}>
                    {t(b.qualityResult === "ACCEPTED" ? "quality.accepted" : "quality.rejected")}
                  </span>
                )}
                {b.netWeightKg !== null && b.netWeightKg !== undefined && (
                  <span className="text-soil-light">
                    {t("weigh.netWeightBadge")}: {b.netWeightKg} kg
                  </span>
                )}
                {b.totalAmount !== null && b.totalAmount !== undefined && (
                  <span className="font-semibold text-field">
                    ₹{b.totalAmount} · {b.billReference}
                  </span>
                )}
                {b.paymentStatus && (
                  <span className="text-soil-light">{t(PAYMENT_KEY[b.paymentStatus])}</span>
                )}
              </div>
            )}
            <button
              className="mt-3 text-xs font-semibold text-sky underline"
              onClick={() => setTimelineId(b.id)}
            >
              {t("timeline.view")}
            </button>
          </div>
        ))}
      </div>
    {timelineId && <TimelineModal bookingId={timelineId} onClose={() => setTimelineId(null)} />}
    </div>
  );
}
