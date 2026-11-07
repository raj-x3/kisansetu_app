// Staff: the centre's waitlist, pending offers, allocation history, and the
// controls to pause or manually run redistribution. Every manual action asks
// for a reason, and the backend records who did it and when.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import { useStaffCentre } from "../utils/useStaffCentre";
import { countdown, shortDate, useNow } from "../utils/queue";
import { kg } from "../utils/kg";
import type { OfficerWaitlist } from "../types";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function WaitlistManagementPanel({ canSetWindow, centres }: { canSetWindow: boolean; centres?: { id: string; name: string }[] }) {
  const { t } = useLanguage();
  const now = useNow(1000);
  const { centreId, setCentreId, centreName } = useStaffCentre(centres);
  const [d, setD] = useState<OfficerWaitlist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [windowMin, setWindowMin] = useState("");
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    if (!centreId) return;
    try {
      const res = await api.get(`/officer/waitlist/${centreId}`);
      setD(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [centreId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (d) setWindowMin(String(d.centre.offerWindowMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.centre.id]);

  useEffect(() => {
    if (!centreId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    };
    const events = ["waitlist-updated", "capacity-updated"];
    events.forEach((e) => socket.on(e, refresh));
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      events.forEach((e) => socket.off(e, refresh));
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [centreId, load]);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(okText);
      setReason("");
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length >= 5;
  const eventText = (e: string) => {
    const k = `wl.ev.${e}`;
    const v = t(k as any);
    return v === k ? e : v;
  };
  const textOr = (prefix: string, code: string | null) => {
    if (!code) return "";
    const k = `${prefix}${code}`;
    const v = t(k as any);
    return v === k ? code : v;
  };

  return (
    <section className="mt-8 rounded-2xl border border-soil-light/20 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-soil">{t("wl.o.title")}</h2>
          <p className="text-xs text-soil-light">{centreName}</p>
        </div>
        {centres && (
          <select className="input-field !w-auto" value={centreId} onChange={(e) => setCentreId(e.target.value)} aria-label={t("q.o.centre")}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-3 rounded-lg border border-field/30 bg-field/10 px-3 py-2 text-sm font-semibold text-field">{message}</div>}
      {!d && !error && <p className="mt-3 text-sm text-soil-light">{t("q.loading")}</p>}

      {d && (
        <>
          {(d.centre.waitlistPaused || d.centre.centrePaused) && (
            <p className="mt-3 rounded-lg bg-soil-light/15 px-3 py-2 text-sm font-semibold text-soil">
              {d.centre.centrePaused ? t("wl.o.centrePaused") : `${t("wl.o.pausedBanner")} ${d.centre.waitlistPauseReason ?? ""}`}
            </p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t("wl.o.waiting")} value={String(d.summary.waitingFarmers)} />
            <Tile label={t("wl.o.eligible")} value={String(d.summary.eligibleNow)} />
            <Tile label={t("wl.o.pendingOffers")} value={String(d.summary.pendingOffers)} hint={kg(d.summary.pendingKg)} />
            <Tile label={t("wl.o.released")} value={kg(d.summary.releasedKg)} hint={t("wl.o.today")} />
            <Tile label={t("wl.o.accepted")} value={String(d.summary.acceptedCount)} hint={kg(d.summary.acceptedKg)} />
            <Tile label={t("wl.o.expired")} value={String(d.summary.expiredCount)} />
            <Tile label={t("wl.o.declined")} value={String(d.summary.declinedCount)} />
            <Tile label={t("wl.o.unallocated")} value={kg(d.summary.returnedToPublicKg)} hint={t("wl.o.unallocatedHint")} />
          </dl>

          {d.byCrop.length > 0 && (
            <p className="mt-3 text-sm text-soil">
              {d.byCrop.map((c) => `${c.cropName}: ${c.waiting} (${kg(c.totalKg)})`).join(" · ")}
            </p>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-soil">{t("wl.o.controls")}</h3>
              <input className="input-field mt-2" maxLength={300} value={reason} placeholder={t("wl.o.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <button
                  className="btn-secondary flex-1"
                  disabled={busy || !reasonOk || d.centre.waitlistPaused || d.centre.centrePaused}
                  onClick={() => run(() => api.post(`/officer/waitlist/${centreId}/redistribute`, { reason: reason.trim() }), t("wl.o.redistributed"))}
                >
                  {t("wl.o.redistribute")}
                </button>
                {d.centre.waitlistPaused ? (
                  <button className="btn-primary flex-1" disabled={busy} onClick={() => run(() => api.post(`/officer/waitlist/${centreId}/pause`, { paused: false, reason: reason.trim() || undefined }), t("wl.o.resumedOk"))}>
                    {t("wl.o.resume")}
                  </button>
                ) : (
                  <button className="btn-secondary flex-1" disabled={busy || !reasonOk} onClick={() => run(() => api.post(`/officer/waitlist/${centreId}/pause`, { paused: true, reason: reason.trim() }), t("wl.o.pausedOk"))}>
                    {t("wl.o.pause")}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-soil-light">{t("wl.o.reasonHint")}</p>
            </div>

            <div>
              <h3 className="font-display text-sm font-semibold text-soil">{t("wl.o.offerWindow")}</h3>
              <p className="text-xs text-soil-light">{t("wl.o.offerWindowHint")}</p>
              <div className="mt-2 flex gap-2">
                <input className="input-field" type="number" min={2} max={240} value={windowMin} disabled={!canSetWindow} onChange={(e) => setWindowMin(e.target.value)} />
                {canSetWindow && (
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => run(() => api.put(`/officer/waitlist/${centreId}/offer-window`, { minutes: Math.round(Number(windowMin)) }), t("wl.o.windowSaved"))}
                  >
                    {t("q.o.save")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <h3 className="mt-6 font-display text-sm font-semibold text-soil">{t("wl.o.pendingTitle")}</h3>
          {d.pendingOffers.length === 0 ? (
            <p className="text-sm text-soil-light">{t("wl.o.noPending")}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {d.pendingOffers.map((o) => (
                <li key={o.id} className="flex flex-wrap justify-between gap-2 border-b border-soil-light/10 py-1.5">
                  <span>{o.farmerName} ({o.farmerCode}) · {o.cropName} {kg(o.quantityKg)} · {shortDate(o.date)} {o.startTime}–{o.endTime}</span>
                  <span className="font-semibold text-field">{countdown(o.expiresAt, now).text}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 font-display text-sm font-semibold text-soil">{t("wl.o.queueTitle")}</h3>
          {d.entries.length === 0 ? (
            <p className="text-sm text-soil-light">{t("wl.o.empty")}</p>
          ) : (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-soil-light">
                  <tr>
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">{t("wl.o.colFarmer")}</th>
                    <th className="py-1 pr-3">{t("wl.o.colRequest")}</th>
                    <th className="py-1 pr-3">{t("wl.o.colWhen")}</th>
                    <th className="py-1">{t("wl.o.colMatch")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.entries.map((e) => (
                    <tr key={e.id} className="border-t border-soil-light/10 align-top">
                      <td className="py-1.5 pr-3 font-semibold">{e.position ?? "—"}</td>
                      <td className="py-1.5 pr-3">{e.farmerName}<br /><span className="text-xs text-soil-light">{e.farmerCode}</span></td>
                      <td className="py-1.5 pr-3">{e.cropName}<br /><span className="text-xs text-soil-light">{kg(e.quantityKg)}</span></td>
                      <td className="py-1.5 pr-3">{shortDate(e.date)}{e.windowStart && e.windowEnd ? <><br /><span className="text-xs text-soil-light">{e.windowStart}–{e.windowEnd}</span></> : null}</td>
                      <td className="py-1.5 text-xs">
                        {e.status === "OFFERED" ? (
                          <span className="font-semibold text-field">{t("wl.status.OFFERED")}</span>
                        ) : e.eligibleSlots.length > 0 ? (
                          <span className="font-semibold text-field">{t("wl.o.fitsNow").replace("{slots}", e.eligibleSlots.map((s) => `${s.startTime}–${s.endTime}`).join(", "))}</span>
                        ) : (
                          <span className="text-soil-light">
                            {textOr("wl.reason.", e.whyNot?.reason ?? "notFullFit")}
                            {e.whyNot?.shortfallKg ? ` (${t("wl.o.short").replace("{kg}", kg(e.whyNot.shortfallKg))})` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button type="button" className="mt-5 text-sm font-semibold text-field underline" onClick={() => setShowLog((v) => !v)}>
            {showLog ? t("wl.o.hideLog") : t("wl.o.showLog")}
          </button>
          {showLog && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="uppercase text-soil-light">
                  <tr>
                    <th className="py-1 pr-3">{t("wl.o.logTime")}</th>
                    <th className="py-1 pr-3">{t("wl.o.logEvent")}</th>
                    <th className="py-1 pr-3">{t("wl.o.logDetail")}</th>
                    <th className="py-1">{t("wl.o.logWhy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.log.map((l) => (
                    <tr key={l.id} className="border-t border-soil-light/10 align-top">
                      <td className="py-1 pr-3 whitespace-nowrap">{when(l.createdAt)}</td>
                      <td className="py-1 pr-3 font-semibold">{eventText(l.event)}</td>
                      <td className="py-1 pr-3">
                        {[l.cropName, l.kg ? kg(l.kg) : "", l.slotStart ? `${l.slotDate ? shortDate(l.slotDate) : ""} ${l.slotStart}` : "", l.farmerCode ?? ""].filter(Boolean).join(" · ")}
                      </td>
                      <td className="py-1">
                        {[textOr("wl.trg.", l.trigger), textOr("wl.reason.", l.reason), l.note ?? ""].filter(Boolean).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-paper px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-soil-light">{label}</dt>
      <dd className="font-display text-xl font-bold text-field">{value}</dd>
      {hint && <p className="text-[11px] text-soil-light">{hint}</p>}
    </div>
  );
}
