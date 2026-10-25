// Lets a farmer move their booking to another time at the SAME centre.
// The server re-checks everything (still at "Slot booked", slot not full,
// no other booking that day), so a slow screen can never double-book.

import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { FarmerBooking } from "../types";

interface Slot {
  id: string;
  startTime: string;
  endTime: string;
  available: number;
  isFull: boolean;
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
    api
      .get("/slots", { params: { centreId: booking.centreId, date } })
      .then((res) => setSlots(res.data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [booking.centreId, date]);

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
              {s.startTime}–{s.endTime}
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
