// Officers' "Emergency requests" section: a filterable list, and a detail
// window with the weather check (and where it came from), the evidence, the
// history, and the decision buttons. The server decides who may do what; the
// buttons here only follow its answer.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import type {
  EmergencyCategory, EmergencyDetail, EmergencyListRow, EmergencyStatus, WeatherVerificationRecord,
} from "../types";
import { kg } from "../utils/kg";
import { openBlob } from "../utils/image";
import { CATEGORIES, OUTCOME_STYLE, STATUS_STYLE, dateTime, reasonText, shortDate } from "../utils/emergency";

const STATUSES: EmergencyStatus[] = [
  "SUBMITTED", "UNDER_VERIFICATION", "AWAITING_REVIEW", "APPROVED", "REJECTED", "RESCHEDULING_AVAILABLE", "RESCHEDULED",
];

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useLanguage();
  const [d, setD] = useState<EmergencyDetail | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const load = useCallback(() => {
    api
      .get(`/officer/emergency-requests/${id}`)
      .then((res) => setD(res.data))
      .catch((err) => setError(getErrorMessage(err)));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function act(action: "APPROVE" | "REJECT" | "FLAG" | "UNFLAG" | "REQUEST_EVIDENCE") {
    setError(null);
    if (action === "APPROVE" && !window.confirm(t("emg.o.confirmApprove"))) return;
    setBusy(true);
    try {
      const res = await api.patch(`/officer/emergency-requests/${id}/review`, { action, remarks: remarks.trim() || undefined });
      setD(res.data);
      setRemarks("");
      onChanged();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/officer/emergency-requests/${id}/reverify`);
      setD(res.data);
      onChanged();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function view(fileId: string, mime: string, name: string) {
    try {
      const res = await api.get(`/emergency-cancellations/${id}/evidence/${fileId}/file`, { responseType: "blob" });
      if (mime.startsWith("image/")) setPreview({ url: URL.createObjectURL(res.data as Blob), name });
      else openBlob(res.data as Blob);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  const v: WeatherVerificationRecord | undefined = d?.verifications[0];
  const canDecide = d?.status === "AWAITING_REVIEW";

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-4 w-full max-w-3xl rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        {!d ? (
          <p className="text-sm text-soil-light">{error ?? t("slots.loading")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-field">{d.requestNo}</h2>
                <p className="text-sm text-soil-light">
                  {d.farmerName} ({d.farmerCode}) · {t("case.id")}: {d.caseId} · #{d.tokenNumber}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.flagged && <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">⚑ {t("emg.o.flagged")}</span>}
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[d.status]}`}>{t(`emg.status.${d.status}` as never)}</span>
              </div>
            </div>

            {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

            <section className="mt-4 grid gap-3 rounded-xl bg-paper p-4 text-sm sm:grid-cols-2">
              <p><span className="text-soil-light">{t("emg.cropQty")}: </span><b>{d.crop} · {kg(d.quantityKg)} kg</b></p>
              <p><span className="text-soil-light">{t("emg.slot")}: </span><b>{shortDate(d.slotDate)} · {d.slotStart}–{d.slotEnd}</b></p>
              <p><span className="text-soil-light">{t("emg.o.category")}: </span><b>{t(`emg.cat.${d.category}` as never)}</b></p>
              <p><span className="text-soil-light">{t("emg.when")}: </span><b>{dateTime(d.incidentAt)}</b></p>
              {d.affectedLat !== null && d.affectedLng !== null && (
                <p className="sm:col-span-2"><span className="text-soil-light">{t("emg.o.location")}: </span><b>{d.affectedLat}, {d.affectedLng}</b> <span className="text-xs text-soil-light">({t("emg.o.approx")})</span></p>
              )}
              <p className="sm:col-span-2"><span className="text-soil-light">{t("emg.describe")}: </span>{d.description}</p>
              {d.farmerReviewNote && <p className="sm:col-span-2"><span className="text-soil-light">{t("emg.o.farmerNote")}: </span>{d.farmerReviewNote}</p>}
              <p className="text-xs text-soil-light sm:col-span-2">{t("emg.o.earlier").replace("{n}", String(d.earlierRequests90Days))}</p>
            </section>

            <section className="mt-4">
              <h3 className="font-display text-sm font-semibold text-soil">{t("emg.o.evidence")} ({d.evidence.length})</h3>
              <p className="text-xs text-soil-light">{t("emg.o.evidenceNote")}</p>
              {d.evidence.length === 0 ? (
                <p className="mt-1 text-sm text-soil-light">{t("emg.o.noEvidence")}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                  {d.evidence.map((f) => (
                    <li key={f.id}>
                      <button className="rounded-full border border-soil-light/30 px-3 py-1 font-semibold text-sky" onClick={() => view(f.id, f.mimeType, f.fileName)}>
                        {f.fileName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {preview && (
                <div className="mt-3 rounded-xl border border-soil-light/20 p-2">
                  <img src={preview.url} alt={preview.name} className="mx-auto max-h-80 rounded-lg" />
                  <button className="mt-2 text-xs font-semibold text-field underline" onClick={() => setPreview(null)}>{t("emg.o.closePreview")}</button>
                </div>
              )}
            </section>

            <section className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-soil">{t("emg.o.weather")}</h3>
                {(d.status === "AWAITING_REVIEW" || d.status === "UNDER_VERIFICATION") && (
                  <button className="text-xs font-semibold text-field underline" disabled={busy} onClick={rerun}>{t("emg.o.rerun")}</button>
                )}
              </div>
              {!v ? (
                <p className="mt-1 text-sm text-soil-light">{t("emg.verificationPending")}</p>
              ) : (
                <div className="mt-2 space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${OUTCOME_STYLE[v.outcome]}`}>{t(`emg.outcome.${v.outcome}` as never)}</span>
                    <span className="text-soil">{t("emg.o.score")}: <b>{v.supportScore}/100</b></span>
                  </div>
                  <p className="text-xs text-soil-light">{t("emg.o.scoreNote")}</p>
                  <p className="text-xs text-soil-light">
                    {t("emg.o.source")}: <b>{v.provider}</b> ({t(`emg.src.${v.source}` as never)}) · {dateTime(v.windowStart)} → {dateTime(v.windowEnd)} · {t("emg.o.checkedAt")} {dateTime(v.createdAt)}
                  </p>
                  {v.observations.note && <p className="text-xs text-soil-light">{v.observations.note}</p>}
                  <ul className="list-disc space-y-1 pl-5 text-soil">
                    {v.reasons.map((r, i) => <li key={i}>{reasonText(r, t)}</li>)}
                  </ul>
                  {v.observations.points.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-xs">
                        <thead className="text-soil-light">
                          <tr>
                            <th className="py-1 pr-2">{t("emg.o.place")}</th>
                            <th className="pr-2">{t("emg.o.rain24")}</th>
                            <th className="pr-2">{t("emg.o.peak")}</th>
                            <th className="pr-2">{t("emg.o.gust")}</th>
                            <th>{t("emg.o.alerts")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.observations.points.map((p, i) => (
                            <tr key={i} className="border-t border-soil-light/15">
                              <td className="py-1 pr-2 font-semibold text-soil">{t(`emg.place.${p.label}` as never)} <span className="font-normal text-soil-light">({p.lat}, {p.lng})</span></td>
                              {p.dataAvailable ? (
                                <>
                                  <td className="pr-2">{p.rain24hMaxMm} mm</td>
                                  <td className="pr-2">{p.rainPeakHourMm} mm/h</td>
                                  <td className="pr-2">{p.gustMaxKph} km/h</td>
                                </>
                              ) : (
                                <td className="pr-2 text-soil-light" colSpan={3}>{t("emg.o.noData")}</td>
                              )}
                              <td>{p.alerts.length > 0 ? p.alerts.map((a) => a.headline).join("; ") : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {d.flagReason && (
                    <p className="text-xs text-red-600">
                      ⚑ {d.flagReason.split(",").map((c) => t(`emg.flag.${c}` as never)).join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </section>

            {d.reviews.length > 0 && (
              <section className="mt-4">
                <h3 className="font-display text-sm font-semibold text-soil">{t("emg.o.history")}</h3>
                <ul className="mt-1 space-y-1 text-xs text-soil">
                  {d.reviews.map((r) => (
                    <li key={r.id}>
                      {dateTime(r.createdAt)} · <b>{t(`emg.o.act.${r.action}` as never)}</b> · {r.officerName}{r.remarks ? ` — ${r.remarks}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-5 rounded-xl border border-soil-light/20 p-4">
              <label className="field-label" htmlFor="emgRemarks">{t("emg.o.remarks")}</label>
              <textarea id="emgRemarks" className="input-field mt-1" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t("emg.o.remarksHint")} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy || !canDecide} onClick={() => act("APPROVE")}>{t("emg.o.approve")}</button>
                <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !canDecide} onClick={() => act("REJECT")}>{t("emg.o.reject")}</button>
                <button className="btn-secondary" disabled={busy || !canDecide} onClick={() => act("REQUEST_EVIDENCE")}>{t("emg.o.askEvidence")}</button>
                <button className="btn-secondary" disabled={busy} onClick={() => act(d.flagged ? "UNFLAG" : "FLAG")}>{d.flagged ? t("emg.o.unflag") : t("emg.o.flag")}</button>
              </div>
              <p className="mt-2 text-xs text-soil-light">{canDecide ? t("emg.o.rulesHint") : t("emg.o.notReady")}</p>
            </section>

            <button className="btn-secondary mt-4" onClick={onClose}>{t("emg.o.close")}</button>
          </>
        )}
      </div>
    </div>
  );
}

export function EmergencyReviewPanel({ centres }: { centres?: { id: string; name: string }[] }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<EmergencyListRow[]>([]);
  const [crops, setCrops] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [crop, setCrop] = useState("");
  const [date, setDate] = useState("");
  const [centreId, setCentreId] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get("/officer/emergency-requests", {
        params: { status, category, crop, date, centreId: centreId || undefined, flagged: flagged ? "true" : undefined },
      })
      .then((res) => {
        setRows(res.data);
        setError(null);
        // Join each centre's live room so new requests appear without a refresh.
        for (const id of new Set((res.data as EmergencyListRow[]).map((r) => r.centreId))) socket.emit("join-centre", id);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [status, category, crop, date, centreId, flagged]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get("/crops/all").then((res) => setCrops(res.data)).catch(() => undefined);
  }, []);
  useEffect(() => {
    socket.on("emergency-updated", load);
    return () => {
      socket.off("emergency-updated", load);
    };
  }, [load]);

  return (
    <section className="mt-8 card">
      <h2 className="font-display text-lg font-semibold text-soil">{t("emg.o.title")}</h2>
      <p className="mt-1 text-sm text-soil-light">{t("emg.o.subtitle")}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {centres && (
          <select className="input-field" aria-label={t("emg.centre")} value={centreId} onChange={(e) => setCentreId(e.target.value)}>
            <option value="">{t("emg.o.allCentres")}</option>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <input type="date" className="input-field" aria-label={t("emg.slot")} value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="input-field" aria-label={t("emg.o.crop")} value={crop} onChange={(e) => setCrop(e.target.value)}>
          <option value="">{t("emg.o.allCrops")}</option>
          {crops.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select className="input-field" aria-label={t("emg.o.category")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("emg.o.allCategories")}</option>
          {CATEGORIES.map((c: EmergencyCategory) => <option key={c} value={c}>{t(`emg.cat.${c}` as never)}</option>)}
        </select>
        <select className="input-field" aria-label={t("emg.o.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("emg.o.allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`emg.status.${s}` as never)}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-soil">
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> {t("emg.o.onlyFlagged")}
        </label>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="mt-4 text-sm text-soil-light">{t("slots.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-soil-light">{t("emg.o.none")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-soil-light">
              <tr>
                <th className="py-2 pr-3">{t("emg.requestNo")}</th>
                <th className="pr-3">{t("emg.o.farmer")}</th>
                <th className="pr-3">{t("emg.cropQty")}</th>
                <th className="pr-3">{t("emg.slot")}</th>
                <th className="pr-3">{t("emg.o.category")}</th>
                <th className="pr-3">{t("emg.verification")}</th>
                <th>{t("emg.o.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-soil-light/15 hover:bg-paper" onClick={() => setOpenId(r.id)}>
                  <td className="py-2 pr-3 font-semibold text-soil">{r.flagged && <span className="text-red-600">⚑ </span>}{r.requestNo}</td>
                  <td className="pr-3">{r.farmerName}</td>
                  <td className="pr-3">{r.crop} · {kg(r.quantityKg)} kg</td>
                  <td className="pr-3">{shortDate(r.slotDate)} {r.slotStart}</td>
                  <td className="pr-3">{t(`emg.cat.${r.category}` as never)}</td>
                  <td className="pr-3">
                    {r.verificationResult ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOME_STYLE[r.verificationResult]}`}>{t(`emg.outcome.${r.verificationResult}` as never)}</span>
                    ) : "—"}
                  </td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{t(`emg.status.${r.status}` as never)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </section>
  );
}
