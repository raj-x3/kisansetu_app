// The farmer's "Emergency requests" card: a simple tracker for each request,
// the officer's remarks, and the next thing the farmer can do (add proof, ask
// for another review, or choose a new time). It updates by itself when the
// server pushes a change.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import type { EmergencyRequestView } from "../types";
import { kg } from "../utils/kg";
import { prepareEvidence, EvidenceFileError, openBlob } from "../utils/image";
import { OUTCOME_STYLE, STATUS_STYLE, dateTime, shortDate, trackerStep } from "../utils/emergency";
import { EmergencyRescheduleModal } from "./EmergencyRescheduleModal";

const STEPS = ["emg.step.sent", "emg.step.checking", "emg.step.officer", "emg.step.decision", "emg.step.newSlot"] as const;

function RequestItem({ r, reload, onBookingChanged }: { r: EmergencyRequestView; reload: () => void; onBookingChanged: () => void }) {
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);
  const step = trackerStep(r.status);
  const rejected = r.status === "REJECTED";

  async function addFile(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const prepared = await prepareEvidence(list[0]);
      await api.post(`/emergency-cancellations/${r.id}/evidence`, {
        evidence: [{ fileName: prepared.fileName, dataBase64: prepared.dataBase64 }],
      });
      reload();
    } catch (e) {
      if (e instanceof EvidenceFileError) setError(e.code === "TYPE" ? t("emg.fileType") : e.code === "BIG" ? t("emg.fileBig") : t("emg.fileRead"));
      else setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function askReview() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/emergency-cancellations/${r.id}/manual-review`, { note: note.trim() || undefined });
      setAsking(false);
      reload();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function viewFile(id: string) {
    try {
      const res = await api.get(`/emergency-cancellations/${r.id}/evidence/${id}/file`, { responseType: "blob" });
      openBlob(res.data as Blob);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <li className="rounded-xl border border-soil-light/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-display text-sm font-semibold text-soil">{t("emg.requestNo")}: {r.requestNo}</p>
          <p className="text-xs text-soil-light">
            {r.crop} · {kg(r.quantityKg)} kg · {r.centreName} · {shortDate(r.slotDate)} {r.slotStart}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{t(`emg.status.${r.status}` as never)}</span>
      </div>

      {/* Tracker: filled dots are steps already reached. */}
      <ol className="mt-4 grid grid-cols-5 gap-1 text-center text-[11px] leading-tight">
        {STEPS.map((key, i) => (
          <li key={key} className="flex flex-col items-center gap-1">
            <span className={`h-3 w-3 rounded-full ${i <= step ? (rejected && i === 3 ? "bg-red-500" : "bg-field") : "bg-soil-light/30"}`} />
            <span className={i <= step ? "font-semibold text-soil" : "text-soil-light"}>{t(key)}</span>
          </li>
        ))}
      </ol>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-soil-light">{t("emg.verification")}:</dt>
          <dd>
            {r.verificationResult ? (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${OUTCOME_STYLE[r.verificationResult]}`}>
                {t(`emg.outcome.${r.verificationResult}` as never)}
              </span>
            ) : (
              <span className="text-soil-light">{t("emg.verificationPending")}</span>
            )}
          </dd>
        </div>
        {r.decidedAt && (
          <div><dt className="inline text-soil-light">{t("emg.decidedOn")}: </dt><dd className="inline text-soil">{dateTime(r.decidedAt)}</dd></div>
        )}
        {r.officerRemarks && (
          <div className="rounded-lg bg-paper px-3 py-2"><dt className="text-xs text-soil-light">{t("emg.remarks")}</dt><dd className="text-soil">{r.officerRemarks}</dd></div>
        )}
        {r.manualReviewRequested && r.status === "AWAITING_REVIEW" && (
          <p className="text-xs font-semibold text-soil">{t("emg.secondReviewPending")}</p>
        )}
        <p className="text-xs text-soil-light">{t("emg.verificationNote")}</p>
      </dl>

      {r.evidence.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {r.evidence.map((f) => (
            <li key={f.id}>
              <button className="rounded-full border border-soil-light/30 px-3 py-1 font-semibold text-sky" onClick={() => viewFile(f.id)}>
                {f.fileName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {r.canAddEvidence && (
          <label className="cursor-pointer text-sm font-semibold text-field underline">
            {busy ? "…" : t("emg.addFile")}
            <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" disabled={busy} onChange={(e) => { void addFile(e.target.files); e.target.value = ""; }} />
          </label>
        )}
        {r.canReschedule && (
          <button className="btn-primary" onClick={() => setShowReschedule(true)}>{t("emg.chooseNewTime")}</button>
        )}
        {r.canRequestReview && !asking && (
          <button className="text-sm font-semibold text-field underline" onClick={() => setAsking(true)}>{t("emg.askReview")}</button>
        )}
      </div>

      {rejected && !r.canRequestReview && r.manualReviewRequested && (
        <p className="mt-3 text-xs text-soil-light">{t("emg.reviewUsed")}</p>
      )}

      {asking && (
        <div className="mt-3 rounded-xl bg-paper p-3">
          <label className="field-label" htmlFor={`rv-${r.id}`}>{t("emg.reviewNote")}</label>
          <textarea id={`rv-${r.id}`} className="input-field mt-1" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 flex gap-3">
            <button className="btn-primary" disabled={busy} onClick={askReview}>{busy ? "…" : t("emg.sendReview")}</button>
            <button className="btn-secondary" onClick={() => setAsking(false)}>{t("cap.panel.cancel")}</button>
          </div>
        </div>
      )}

      {showReschedule && (
        <EmergencyRescheduleModal
          request={r}
          onClose={() => setShowReschedule(false)}
          onDone={() => {
            setShowReschedule(false);
            reload();
            onBookingChanged();
          }}
        />
      )}
    </li>
  );
}

export function EmergencyStatusCard({ reloadKey, onBookingChanged }: { reloadKey: number; onBookingChanged: () => void }) {
  const { t } = useLanguage();
  const [list, setList] = useState<EmergencyRequestView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get("/emergency-cancellations/mine")
      .then((res) => {
        setList(res.data);
        setError(null);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  useEffect(load, [load, reloadKey]);

  // The server tells us when a request changes (checked, decided, ...).
  useEffect(() => {
    socket.emit("join-user", localStorage.getItem("token"));
    const onChange = () => {
      load();
      onBookingChanged();
    };
    socket.on("emergency-updated", onChange);
    return () => {
      socket.off("emergency-updated", onChange);
    };
  }, [load, onBookingChanged]);

  if (list.length === 0 && !error) return null;
  return (
    <div className="mt-8 card">
      <h2 className="font-display text-lg font-semibold text-soil">{t("emg.cardTitle")}</h2>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <ul className="mt-4 space-y-4">
        {list.map((r) => (
          <RequestItem key={r.id} r={r} reload={load} onBookingChanged={onBookingChanged} />
        ))}
      </ul>
    </div>
  );
}
