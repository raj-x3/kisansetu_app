// Lets a farmer change the estimated weight of a booking that is still at
// "Slot booked". The server decides: a bigger weight is accepted only if
// the same slot still has that much room for the same crop; a smaller
// weight frees the difference straight away.

import { useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { FarmerBooking } from "../types";
import { kg } from "../utils/kg";

export function ChangeWeightModal({
  booking,
  onClose,
  onChanged,
}: {
  booking: FarmerBooking;
  onClose: () => void;
  onChanged: (newKg: number) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(String(Math.round(booking.quantityKg)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const quantityKg = Number(value);
    if (!Number.isFinite(quantityKg)) {
      setError(t("booking.qtyError"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/bookings/${booking.id}/weight`, { quantityKg });
      onChanged(res.data.quantityKg);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-field">{t("cap.changeWeight")}</h2>
        <p className="mt-1 text-sm text-soil-light">
          {booking.crop} · {booking.startTime}–{booking.endTime} · {kg(booking.quantityKg)} kg
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <label className="field-label mt-4 block" htmlFor="newWeight">{t("cap.newWeight")}</label>
        <input
          id="newWeight"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          className="input-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="mt-2 text-xs text-soil-light">{t("cap.weightNote")}</p>

        <div className="mt-6 flex gap-3">
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>
            {busy ? "…" : t("cap.panel.save")}
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>
            {t("cap.panel.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
