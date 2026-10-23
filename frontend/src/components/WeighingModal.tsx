import { useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { QueueRow } from "../types";

export function WeighingModal({
  row,
  onClose,
  onDone,
}: {
  row: QueueRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [grossWeightKg, setGrossWeightKg] = useState("");
  const [tareWeightKg, setTareWeightKg] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = Number(grossWeightKg);
  const tare = Number(tareWeightKg);
  const netPreview = grossWeightKg && tareWeightKg ? Math.max(0, gross - tare) : null;

  async function submit() {
    if (!grossWeightKg || !tareWeightKg) {
      setError("Enter both gross and tare weight.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/operator/weigh/${row.bookingId}`, {
        grossWeightKg: gross,
        tareWeightKg: tare,
        remarks: remarks || undefined,
      });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-field">{t("weigh.title")}</h2>
        <p className="mt-1 text-sm text-soil-light">
          {row.farmerName} · {t("operator.tableToken")} {row.tokenNumber} · {row.crop}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">{t("weigh.grossWeight")}</label>
            <input
              type="number"
              className="input-field"
              value={grossWeightKg}
              onChange={(e) => setGrossWeightKg(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">{t("weigh.tareWeight")}</label>
            <input
              type="number"
              className="input-field"
              value={tareWeightKg}
              onChange={(e) => setTareWeightKg(e.target.value)}
            />
          </div>
        </div>

        {netPreview !== null && (
          <p className="mt-3 rounded-lg bg-sky/10 px-3 py-2 text-sm font-semibold text-sky">
            {t("weigh.netWeight")}: {netPreview} kg
          </p>
        )}

        <div className="mt-3">
          <label className="field-label">{t("weigh.remarks")}</label>
          <input className="input-field" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <button
          className="btn-primary mt-5 w-full"
          onClick={submit}
          disabled={submitting}
        >
          {t("weigh.submit")}
        </button>
      </div>
    </div>
  );
}
