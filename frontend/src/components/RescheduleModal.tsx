// Lets a farmer move their booking to another time at the SAME centre.
// The server re-checks everything (still at "Slot booked", slot not full,
// no other booking that day), so a slow screen can never double-book.

import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { FarmerBooking, Recommendation } from "../types";
import { kg } from "../utils/kg";

// What the modal needs to draw one choice. Built from either the
// crop-aware recommendation (normal case) or the older farmer-count list
// (only for bookings made before weight-based capacity existed).
interface Slot {
  id: string;
  startTime: string;
  endTime: string;
  isFull: boolean;
  recommended: boolean;
  remainingKg: number | null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function RescheduleModal({
  booking,
  onClose,
  onMoved,
}: {
  booking: FarmerBooking;
  onClose: () => void;
  onMoved: (updated: { tokenNumber: number; date: string; startTime: string; endTime: string }) => void;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState(booking.date.slice(0, 10) < todayStr() ? todayStr() : booking.date.slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    const weightKg = Math.round(booking.quantityKg);
    const request = booking.cropId
      ? api
          .get("/slots/recommend", { params: { centreId: booking.centreId, cropId: booking.cropId, date, weightKg } })
          .then((res) => {
            const r: Recommendation = res.data;
            return r.slots
              // The slot you already hold is not a "move".
              .filter((s) => !(date === booking.date.slice(0, 10) && s.startTime === booking.startTime))
              .map<Slot>((s) => ({
                id: s.slotId,
                startTime: s.startTime,
                endTime: s.endTime,
                isFull: s.rank === "NOT_SUITABLE",
                recommended: s.rank === "RECOMMENDED",
                remainingKg: s.remainingKg,
              }))
              .sort((a, b) => a.startTime.localeCompare(b.startTime));
          })
      : api.get("/slots", { params: { centreId: booking.centreId, date } }).then((res) =>
          (res.data as { id: string; startTime: string; endTime: string; isFull: boolean }[]).map<Slot>((s) => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            isFull: s.isFull,
            recommended: false,
            remainingKg: null,
          }))
        );
    request
      .then((list) => setSlots(list))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [booking.centreId, booking.cropId, booking.quantityKg, booking.date, booking.startTime, date]);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/bookings/${booking.id}/reschedule`, { slotId: selected });
      onMoved(res.data.booking);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-field">{t("booking.changeTitle")}</h2>
        <p className="mt-1 text-sm text-soil-light">
          {booking.centreName} · {t("case.id")}: {booking.caseId}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <label className="field-label mt-4 block" htmlFor="newDate">
          {t("booking.date")}
        </label>
        <input
          id="newDate"
          type="date"
          className="input-field"
          min={todayStr()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        {booking.cropId && (
          <p className="mt-3 rounded-lg bg-wheat-light/30 px-3 py-2 text-xs text-soil">
            {t("cap.reschedule.note").replace("{kg}", kg(booking.quantityKg)).replace("{crop}", booking.crop)}
          </p>
        )}

        <p className="field-label mt-4">{t("booking.pickSlot")}</p>
        {loading && <p className="text-sm text-soil-light">{t("slots.loading")}</p>}
        {!loading && slots.length === 0 && <p className="text-sm text-soil-light">{t("slots.none")}</p>}
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {slots.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={s.isFull}
              onClick={() => setSelected(s.id)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                selected === s.id
                  ? "border-field bg-field text-paper"
                  : s.isFull
                  ? "cursor-not-allowed border-soil-light/20 bg-soil-light/10 text-soil-light"
                  : "border-soil-light/30 bg-white text-soil hover:border-field"
              }`}
            >
              {s.recommended ? "★ " : ""}
              {s.startTime}–{s.endTime}
              {s.remainingKg !== null && (
                <span className="mt-0.5 block text-xs font-normal opacity-80">{kg(s.remainingKg)} kg</span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <button className="btn-primary flex-1" onClick={confirm} disabled={!selected || busy}>
            {t("booking.confirmMove")}
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>
            {t("doc.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
