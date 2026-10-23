// The farmer's "Your documents" card: upload files for the current
// booking and see whether the document desk has verified them.
//
// All real checks (file type by content, size, who may upload, which
// stage) happen on the server. The checks here only save the farmer a
// round trip.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import type { CaseDocument, DocumentType } from "../types";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: DocumentType[] = ["IDENTITY_PROOF", "LAND_RECORD", "OTHER"];

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-wheat-light/40 text-soil",
  VERIFIED: "bg-field/10 text-field",
  REJECTED: "bg-red-50 text-red-600",
  CORRECTION_REQUESTED: "bg-sky/10 text-sky",
};

// Opens a document in a new tab. The file needs the login token, so we
// download it with the API client and show the downloaded copy.
export async function openDocument(id: string): Promise<void> {
  const res = await api.get(`/documents/${id}/file`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function DocumentsPanel({ bookingId, stage }: { bookingId: string; stage: string }) {
  const { t } = useLanguage();
  const [docs, setDocs] = useState<CaseDocument[]>([]);
  const [docType, setDocType] = useState<DocumentType>("IDENTITY_PROOF");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canUpload = stage === "SLOT_BOOKED" || stage === "ARRIVED";

  const load = useCallback(() => {
    api
      .get(`/documents/booking/${bookingId}`)
      .then((res) => setDocs(res.data))
      .catch((err) => setError(getErrorMessage(err)));
  }, [bookingId]);

  useEffect(() => {
    load();
    function onUpdated(p: { bookingId: string }) {
      if (p.bookingId === bookingId) load();
    }
    socket.on("documents-updated", onUpdated);
    return () => {
      socket.off("documents-updated", onUpdated);
    };
  }, [bookingId, load]);

  async function upload() {
    if (!file) return;
    setError(null);
    setMessage(null);
    if (file.size > MAX_BYTES) return setError(t("doc.tooBig"));
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) return setError(t("doc.badType"));
    setBusy(true);
    try {
      const dataBase64 = await readAsBase64(file);
      await api.post(`/documents/booking/${bookingId}`, { type: docType, fileName: file.name, dataBase64 });
      setFile(null);
      setMessage(t("doc.uploaded"));
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 card">
      <h2 className="font-display text-lg font-semibold text-soil">{t("doc.title")}</h2>
      <p className="mt-1 text-sm text-soil-light">{t("doc.subtitle")}</p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="mt-3 rounded-lg bg-field/10 px-3 py-2 text-sm font-semibold text-field">{message}</div>
      )}

      {docs.length === 0 ? (
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
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[d.status]}`}>
                    {t(`doc.status.${d.status}` as never)}
                  </span>
                  <button
                    className="text-xs font-semibold text-field underline"
                    onClick={() => openDocument(d.id).catch((e) => setError(getErrorMessage(e)))}
                  >
                    {t("doc.view")}
                  </button>
                </div>
              </div>
              {d.reviewNote && (
                <p className="mt-2 text-xs text-soil-light">
                  {t("doc.reason")}: {d.reviewNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div>
            <label className="field-label">{t("doc.typeLabel")}</label>
            <select className="input-field" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`doc.type.${x}` as never)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">{t("doc.choose")}</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              className="input-field"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button className="btn-primary !py-3" onClick={upload} disabled={!file || busy}>
            {busy ? t("doc.uploading") : t("doc.upload")}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-soil-light">{t("doc.closedNote")}</p>
      )}
    </div>
  );
}
