// Shown on the booking page when the farmer's full quantity does not fit in
// any slot (or they want a different time). Joining is optional. The backend
// refuses it if a slot with enough room exists, and never splits a booking.

import { useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { kg } from "../utils/kg";

export function JoinWaitlistBox({
  centreId,
  cropId,
  cropName,
  date,
  weightKg,
  prominent,
}: {
  centreId: string;
  cropId: string;
  cropName: string;
  date: string;
  weightKg: number;
  prominent: boolean;
}) {
  const { t } = useLanguage();
  const [useWindow, setUseWindow] = useState(false);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/waitlist", {
        centreId,
        cropId,
        quantityKg: weightKg,
        date,
        ...(useWindow ? { windowStart: from, windowEnd: to } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-4 rounded-2xl border border-field/30 bg-field/10 p-4 text-sm font-semibold text-field">
        {t("wl.joined")} <a className="underline" href="/farmer/dashboard">{t("wl.seeDashboard")}</a>
      </div>
    );
  }

  return (
    <div className={`mt-4 rounded-2xl border p-4 ${prominent ? "border-wheat-dark bg-wheat-light/30" : "border-soil-light/20 bg-white"}`}>
      <h3 className="font-display text-base font-semibold text-soil">{t("wl.joinTitle")}</h3>
      <p className="mt-1 text-sm text-soil-light">
        {t("wl.joinText").replace("{kg}", kg(weightKg)).replace("{crop}", cropName)}
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm text-soil">
        <input type="checkbox" checked={useWindow} onChange={(e) => setUseWindow(e.target.checked)} />
        {t("wl.onlyBetween")}
      </label>
      {useWindow && (
        <div className="mt-2 flex items-center gap-2">
          <input type="time" className="input-field !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("wl.from")} />
          <span>–</span>
          <input type="time" className="input-field !w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("wl.to")} />
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      <button className="btn-secondary mt-3 w-full sm:w-auto" disabled={busy} onClick={join}>
        {busy ? t("wl.working") : t("wl.join")}
      </button>
      <p className="mt-2 text-xs text-soil-light">{t("wl.joinNote")}</p>
    </div>
  );
}
