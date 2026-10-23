// Lets the document officer open each uploaded file and verify it,
// reject it, or ask the farmer to fix it. Rejecting or asking for a
// correction needs a short reason, which the farmer sees.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { openDocument } from "./DocumentsPanel";
import type { CaseDocument, QueueRow } from "../types";

type Decision = "VERIFIED" | "REJECTED" | "CORRECTION_REQUESTED";

export function DocumentReviewModal({ row, onClose }: { row: QueueRow; onClose: () => void }) {
  const { t } = useLanguage();
  const [docs, setDocs] = useState<CaseDocument[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .get(`/documents/booking/${row.bookingId}`)
      .then((res) => setDocs(res.data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [row.bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, decision: Decision) {
    setError(null);
    setBusyId(id);
    try {
      await api.post(`/documents/${id}/review`, { decision, note: notes[id] ?? "" });
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-field">{t("doc.reviewTitle")}</h2>
        <p className="mt-1 text-sm text-soil-light">
          {row.farmerName} · {row.caseId} · {t("operator.tableToken")} {row.tokenNumber}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        {loading ? (
          <p className="mt-4 text-sm text-soil-light">…</p>
        ) : docs.length === 0 ? (
          <p className="mt-4 text-sm text-soil-light">{t("doc.noDocs")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {docs.map((d) => (
              <li key={d.id} className="rounded-xl border border-soil-light/20 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-soil">{t(`doc.type.${d.type}` as never)}</p>
                    <p className="text-xs text-soil-light">{d.fileName}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-soil">{t(`doc.status.${d.status}` as never)}</span>
                    <button
                      className="text-xs font-semibold text-field underline"
                      onClick={() => openDocument(d.id).catch((e) => setError(getErrorMessage(e)))}
                    >
                      {t("doc.view")}
                    </button>
                  </div>
                </div>

                {d.status !== "VERIFIED" && (
                  <div className="mt-3">
                    <input
                      className="input-field"
                      placeholder={t("doc.notePlaceholder")}
                      value={notes[d.id] ?? ""}
                      maxLength={300}
                      onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg bg-field px-3 py-1.5 text-xs font-semibold text-paper hover:bg-field-dark disabled:opacity-50"
                        disabled={busyId === d.id}
                        onClick={() => review(d.id, "VERIFIED")}
                      >
                        {t("doc.verify")}
                      </button>
                      <button
                        className="rounded-lg bg-sky px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50"
                        disabled={busyId === d.id}
                        onClick={() => review(d.id, "CORRECTION_REQUESTED")}
                      >
                        {t("doc.askCorrection")}
                      </button>
                      <button
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        disabled={busyId === d.id}
                        onClick={() => review(d.id, "REJECTED")}
                      >
                        {t("doc.reject")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <button className="btn-secondary mt-5 w-full" onClick={onClose}>
          {t("doc.close")}
        </button>
      </div>
    </div>
  );
}
