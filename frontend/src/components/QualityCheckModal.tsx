import { useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { QueueRow } from "../types";

export function QualityCheckModal({
  row,
  onClose,
  onDone,
}: {
  row: QueueRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [moisturePercent, setMoisturePercent] = useState("");
  const [foreignMatter, setForeignMatter] = useState("");
  const [qualityGrade, setQualityGrade] = useState("A");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(result: "ACCEPTED" | "REJECTED") {
    if (!moisturePercent || !foreignMatter) {
      setError("Enter moisture and foreign material percentages.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/operator/quality-check/${row.bookingId}`, {
        moisturePercent: Number(moisturePercent),
        foreignMatter: Number(foreignMatter),
        qualityGrade,
        remarks: remarks || undefined,
        result,
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
        <h2 className="font-display text-lg font-bold text-field">{t("quality.title")}</h2>
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
            <label className="field-label">{t("quality.moisture")}</label>
            <input
              type="number"
              className="input-field"
              value={moisturePercent}
              onChange={(e) => setMoisturePercent(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">{t("quality.foreignMatter")}</label>
            <input
              type="number"
              className="input-field"
              value={foreignMatter}
              onChange={(e) => setForeignMatter(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="field-label">{t("quality.grade")}</label>
          <select className="input-field" value={qualityGrade} onChange={(e) => setQualityGrade(e.target.value)}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>

        <div className="mt-3">
          <label className="field-label">{t("quality.remarks")}</label>
          <input className="input-field" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <div className="mt-5 flex gap-3">
          <button
            className="flex-1 rounded-xl bg-field py-3 text-sm font-semibold text-paper hover:bg-field-dark disabled:opacity-50"
            onClick={() => submit("ACCEPTED")}
            disabled={submitting}
          >
            {t("quality.accept")}
          </button>
          <button
            className="flex-1 rounded-xl border-2 border-red-500 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            onClick={() => submit("REJECTED")}
            disabled={submitting}
          >
            {t("quality.reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
