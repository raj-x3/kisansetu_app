// The farmer's emergency cancellation form. It only collects what the
// officer needs: what happened, when, a few words, and (optionally) proof.
// The server checks everything again and decides what is allowed.

import { useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import type { EmergencyCategory, EmergencyRequestView, FarmerBooking } from "../types";
import { kg } from "../utils/kg";
import { prepareEvidence, EvidenceFileError, PreparedFile } from "../utils/image";
import { CATEGORIES, localInputValue, shortDate } from "../utils/emergency";

const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 2_400_000;

export function EmergencyModal({
  booking,
  onClose,
  onSent,
}: {
  booking: FarmerBooking;
  onClose: () => void;
  onSent: (r: EmergencyRequestView) => void;
}) {
  const { t } = useLanguage();
  const [category, setCategory] = useState<EmergencyCategory | null>(null);
  const [description, setDescription] = useState("");
  const [incidentAt, setIncidentAt] = useState(localInputValue(new Date()));
  const [place, setPlace] = useState<{ lat: number; lng: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function shareLocation() {
    setError(null);
    if (!navigator.geolocation) return setError(t("emg.locFail"));
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocBusy(false);
      },
      () => {
        setLocBusy(false);
        setError(t("emg.locFail"));
      },
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        setError(t("emg.tooManyFiles"));
        break;
      }
      try {
        next.push(await prepareEvidence(f));
      } catch (e) {
        const code = e instanceof EvidenceFileError ? e.code : "READ";
        setError(code === "TYPE" ? t("emg.fileType") : code === "BIG" ? t("emg.fileBig") : t("emg.fileRead"));
      }
    }
    if (next.reduce((n, f) => n + f.bytes, 0) > MAX_TOTAL_BYTES) {
      setError(t("emg.filesTotalBig"));
      return;
    }
    setFiles(next);
  }

  async function submit() {
    setError(null);
    if (!category) return setError(t("emg.errCategory"));
    if (description.trim().length < 10) return setError(t("emg.errDescription"));
    const when = new Date(incidentAt);
    if (Number.isNaN(when.getTime())) return setError(t("emg.errWhen"));
    setBusy(true);
    try {
      const res = await api.post("/emergency-cancellations", {
        bookingId: booking.id,
        category,
        description: description.trim(),
        incidentAt: when.toISOString(),
        ...(place ? { affectedLat: place.lat, affectedLng: place.lng } : {}),
        evidence: files.map((f) => ({ fileName: f.fileName, dataBase64: f.dataBase64 })),
      });
      onSent(res.data as EmergencyRequestView);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-red-600">{t("emg.title")}</h2>
        <p className="mt-1 text-sm text-soil-light">{t("emg.intro")}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-paper p-3 text-sm">
          <div><dt className="text-xs text-soil-light">{t("case.id")}</dt><dd className="font-semibold text-soil">{booking.caseId}</dd></div>
          <div><dt className="text-xs text-soil-light">{t("emg.centre")}</dt><dd className="font-semibold text-soil">{booking.centreName}</dd></div>
          <div><dt className="text-xs text-soil-light">{t("emg.cropQty")}</dt><dd className="font-semibold text-soil">{booking.crop} · {kg(booking.quantityKg)} kg</dd></div>
          <div><dt className="text-xs text-soil-light">{t("emg.slot")}</dt><dd className="font-semibold text-soil">{shortDate(booking.date)} · {booking.startTime}–{booking.endTime}</dd></div>
        </dl>

        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <fieldset className="mt-4">
          <legend className="field-label">{t("emg.whatHappened")}</legend>
          <div className="mt-2 grid gap-2">
            {CATEGORIES.map((c) => (
              <label
                key={c}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                  category === c ? "border-field bg-field/5 font-semibold text-field" : "border-soil-light/30 text-soil"
                }`}
              >
                <input type="radio" name="emgCategory" checked={category === c} onChange={() => setCategory(c)} />
                {t(`emg.cat.${c}` as never)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field-label mt-4 block" htmlFor="emgDesc">{t("emg.describe")}</label>
        <textarea
          id="emgDesc"
          className="input-field min-h-[90px]"
          maxLength={500}
          placeholder={t("emg.describeHint")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <label className="field-label mt-4 block" htmlFor="emgWhen">{t("emg.when")}</label>
        <input id="emgWhen" type="datetime-local" className="input-field" value={incidentAt} onChange={(e) => setIncidentAt(e.target.value)} />

        <div className="mt-4 rounded-xl border border-soil-light/20 p-3">
          <p className="field-label">{t("emg.where")}</p>
          <p className="mt-1 text-xs text-soil-light">{t("emg.whereHint")}</p>
          {place ? (
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-field">{t("emg.locShared")}</span>
              <button type="button" className="text-xs font-semibold text-red-600 underline" onClick={() => setPlace(null)}>
                {t("emg.locRemove")}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary mt-2" disabled={locBusy} onClick={shareLocation}>
              {locBusy ? "…" : t("emg.locShare")}
            </button>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-soil-light/20 p-3">
          <p className="field-label">{t("emg.evidence")}</p>
          <p className="mt-1 text-xs text-soil-light">{t("emg.evidenceHint")}</p>
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            multiple
            className="mt-2 block w-full text-sm"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="truncate text-soil">{f.fileName} <span className="text-xs text-soil-light">({Math.max(1, Math.round(f.bytes / 1024))} KB)</span></span>
                  <button type="button" className="text-xs font-semibold text-red-600 underline" onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                    {t("emg.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-soil-light">{t("emg.evidencePrivacy")}</p>
        </div>

        <p className="mt-4 rounded-lg bg-wheat-light/30 px-3 py-2 text-xs text-soil">{t("emg.noGuarantee")}</p>

        <div className="mt-5 flex gap-3">
          <button className="btn-primary flex-1" disabled={busy} onClick={submit}>
            {busy ? "…" : t("emg.send")}
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>
            {t("cap.panel.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
