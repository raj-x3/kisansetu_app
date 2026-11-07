// After an officer approves an emergency request, the farmer picks a new slot
// here. The list comes from the server: only slots that can hold the WHOLE
// weight of the same crop at the same centre. The server checks again on confirm.

import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { EmergencyRequestView, RescheduleOption } from "../types";
import { kg } from "../utils/kg";
import { shortDate } from "../utils/emergency";

interface OptionsResponse {
  crop: string;
  quantityKg: number;
  centreName: string;
  options: RescheduleOption[];
}

export function EmergencyRescheduleModal({
  request,
  onClose,
  onDone,
}: {
  request: EmergencyRequestView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<OptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .get(`/emergency-cancellations/${request.id}/reschedule-options`)
      .then((res) => {
        setData(res.data);
        const first = (res.data as OptionsResponse).options.find((o) => o.recommended);
        setSelected((prev) => prev ?? first?.slotId ?? null);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [request.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/emergency-cancellations/${request.id}/reschedule`, { slotId: selected });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
      setSelected(null);
      load(); // the slot may have just filled up: show fresh options
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-field">{t("emg.rs.title")}</h2>
        <p className="mt-1 text-sm text-soil-light">
          {request.centreName} · {request.crop} · {kg(request.quantityKg)} kg
        </p>
        <p className="mt-2 rounded-lg bg-wheat-light/30 px-3 py-2 text-xs text-soil">{t("emg.rs.note")}</p>

        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {loading && <p className="mt-4 text-sm text-soil-light">{t("slots.loading")}</p>}
        {!loading && data && data.options.length === 0 && <p className="mt-4 text-sm text-soil-light">{t("emg.rs.none")}</p>}

        <div className="mt-4 space-y-2">
          {data?.options.map((o) => (
            <button
              key={o.slotId}
              type="button"
              onClick={() => setSelected(o.slotId)}
              className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                selected === o.slotId ? "border-field bg-field/5" : "border-soil-light/30 hover:border-field"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-soil">
                  {shortDate(o.date)} · {o.startTime}–{o.endTime}
                </span>
                {o.recommended && (
                  <span className="rounded-full bg-field px-2 py-0.5 text-xs font-semibold text-white">{t("emg.rs.earliest")}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-soil-light">
                {t("emg.rs.room").replace("{kg}", kg(o.remainingKg))} · {t("emg.rs.busy").replace("{pct}", String(o.utilizationPct))}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          <button className="btn-primary flex-1" disabled={busy || !selected} onClick={confirm}>
            {busy ? "…" : t("emg.rs.confirm")}
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>
            {t("cap.panel.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
