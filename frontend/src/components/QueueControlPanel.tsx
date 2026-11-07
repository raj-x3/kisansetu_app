// Staff: live queue outlook and centre controls.
//
// The outlook is a transparent calculation from today's real bookings, the
// centre's measured (or baseline) processing speed and its counters. It is
// NOT machine learning, and the panel says so.
//
// Desk staff can look; admin, manager and operator may also report counters,
// a delay or a pause (the backend enforces this again).

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import { useStaffCentre } from "../utils/useStaffCentre";
import { LevelBadge } from "./LiveQueuePanel";
import type { CongestionForecast } from "../types";

const STAGE_KEY: Record<string, string> = {
  ARRIVED: "stage.arrived",
  VERIFIED: "stage.verified",
  QUALITY_CHECKED: "stage.qualityCheck",
  WEIGHED: "stage.weighed",
};

const OUTLOOK_STYLE: Record<CongestionForecast["outlook"], string> = {
  NORMAL: "bg-field/10 text-field",
  MODERATE: "bg-wheat-light/50 text-wheat-dark",
  HIGH: "bg-red-50 text-red-600",
  DELAY_RISK: "bg-orange-50 text-orange-600",
};

export function QueueControlPanel({ canControl, centres }: { canControl: boolean; centres?: { id: string; name: string }[] }) {
  const { t } = useLanguage();
  const { centreId, setCentreId, centreName } = useStaffCentre(centres);
  const [f, setF] = useState<CongestionForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [counters, setCounters] = useState("");
  const [delay, setDelay] = useState("0");
  const [delayNote, setDelayNote] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  const load = useCallback(async () => {
    if (!centreId) return;
    try {
      const res = await api.get(`/queue/${centreId}/congestion`);
      setF(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [centreId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Put the current settings into the form when a different centre is loaded.
  useEffect(() => {
    if (!f) return;
    setCounters(f.activeCountersSetting === null ? "" : String(f.activeCountersSetting));
    setDelay(String(f.delayMinutes));
    setDelayNote(f.delayNote ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.centreId]);

  useEffect(() => {
    if (!centreId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    };
    const events = ["queue-updated", "stage-updated", "capacity-updated"];
    events.forEach((e) => socket.on(e, refresh));
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      events.forEach((e) => socket.off(e, refresh));
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [centreId, load]);

  async function save(body: Record<string, unknown>, okKey: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.patch(`/queue/${centreId}/status`, body);
      setMessage(t(okKey as any));
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-soil-light/20 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-soil">{t("q.o.title")}</h2>
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
      {!f && !error && <p className="mt-3 text-sm text-soil-light">{t("q.loading")}</p>}

      {f && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <LevelBadge level={f.level} />
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${OUTLOOK_STYLE[f.outlook]}`}>{t(`q.o.outlook.${f.outlook}` as any)}</span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t("q.o.currentQueue")} value={`${f.currentQueue}`} hint={t("q.o.waitProc").replace("{w}", String(f.waiting)).replace("{p}", String(f.processing))} />
            <Tile label={t("q.o.expected")} value={`${f.expectedArrivals}`} hint={t("q.o.showUp").replace("{pct}", String(f.showUpRate)).replace("{basis}", t(f.showUpBasis === "MEASURED" ? "q.measured" : "q.baseline"))} />
            <Tile label={t("q.o.peak")} value={`${f.predictedPeakQueue}`} hint={t("q.o.peakHint")} />
            <Tile label={t("q.o.workload")} value={t("q.o.minutes").replace("{n}", String(f.estimatedWorkloadMin))} hint={t("q.o.workloadHint")} />
            <Tile label={t("q.o.counters")} value={`${f.counters}`} hint={f.activeCountersSetting === null ? t("q.o.countersAuto") : t("q.o.countersSet")} />
            <Tile label={t("q.o.utilization")} value={`${f.counterUtilizationPct}%`} hint={t("q.o.utilHint")} />
            <Tile label={t("q.o.avgTime")} value={t("q.o.minutes").replace("{n}", String(Math.round(f.avgProcessingMin)))} hint={`${t(f.basis === "MEASURED" ? "q.measured" : "q.baseline")} · ${t("q.o.samples").replace("{n}", String(f.samples))}`} />
          </dl>

          <h3 className="mt-5 font-display text-sm font-semibold text-soil">{t("q.o.bottlenecks")}</h3>
          <ul className="mt-1 space-y-1 text-sm text-soil">
            {f.backlogStage && <li>⚠ {t("q.o.backlog").replace("{stage}", t((STAGE_KEY[f.backlogStage.stage] ?? "stage.arrived") as any)).replace("{n}", String(f.backlogStage.count))}</li>}
            {f.slowestStage && (
              <li>
                ⏱ {t("q.o.slowest").replace("{stage}", t((STAGE_KEY[f.slowestStage.stage] ?? "stage.arrived") as any)).replace("{min}", String(f.slowestStage.avgMin))}
              </li>
            )}
            {!f.backlogStage && !f.slowestStage && <li className="text-soil-light">{t("q.o.noBottleneck")}</li>}
          </ul>

          {f.hours.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-soil-light">
                  <tr>
                    <th className="py-1 pr-3">{t("q.o.hour")}</th>
                    <th className="py-1 pr-3">{t("q.o.colArrivals")}</th>
                    <th className="py-1 pr-3">{t("q.o.colCapacity")}</th>
                    <th className="py-1 pr-3">{t("q.o.colQueue")}</th>
                    <th className="py-1 pr-3">{t("q.o.colWait")}</th>
                    <th className="py-1">{t("q.o.colLevel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.hours.map((h) => (
                    <tr key={h.hour} className="border-t border-soil-light/10">
                      <td className="py-1.5 pr-3 font-semibold">{String(h.hour).padStart(2, "0")}:00</td>
                      <td className="py-1.5 pr-3">{h.expectedArrivals}</td>
                      <td className="py-1.5 pr-3">{h.capacityFarmers}</td>
                      <td className="py-1.5 pr-3">{h.predictedQueue}</td>
                      <td className="py-1.5 pr-3">{t("q.o.minutes").replace("{n}", String(h.predictedWaitMin))}</td>
                      <td className="py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTLOOK_STYLE[h.level]}`}>{t(`q.o.hourLevel.${h.level}` as any)}</span>
                        {h.delayRisk && <span className="ml-1 text-xs text-orange-600">⚠ {t("q.o.delayRisk")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-soil-light">{t("q.o.methodNote")}</p>

          {canControl && (
            <div className="mt-6 grid gap-4 border-t border-soil-light/15 pt-5 md:grid-cols-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-soil">{t("q.o.setCounters")}</h3>
                <p className="text-xs text-soil-light">{t("q.o.setCountersHint")}</p>
                <input className="input-field mt-2" type="number" min={1} max={50} value={counters} placeholder={t("q.o.auto")} onChange={(e) => setCounters(e.target.value)} />
                <button
                  className="btn-secondary mt-2 w-full"
                  disabled={saving}
                  onClick={() => save({ activeCounters: counters.trim() === "" ? null : Number(counters) }, "q.o.saved")}
                >
                  {t("q.o.save")}
                </button>
              </div>

              <div>
                <h3 className="font-display text-sm font-semibold text-soil">{t("q.o.reportDelay")}</h3>
                <p className="text-xs text-soil-light">{t("q.o.reportDelayHint")}</p>
                <input className="input-field mt-2" type="number" min={0} max={480} value={delay} onChange={(e) => setDelay(e.target.value)} />
                <input className="input-field mt-2" maxLength={200} value={delayNote} placeholder={t("q.o.delayNote")} onChange={(e) => setDelayNote(e.target.value)} />
                <button
                  className="btn-secondary mt-2 w-full"
                  disabled={saving}
                  onClick={() => save({ delayMinutes: Math.max(0, Number(delay) || 0), delayNote: delayNote.trim() || undefined }, "q.o.saved")}
                >
                  {t("q.o.save")}
                </button>
              </div>

              <div>
                <h3 className="font-display text-sm font-semibold text-soil">{t("q.o.pauseTitle")}</h3>
                <p className="text-xs text-soil-light">{f.isPaused ? `${t("q.o.pausedNow")} ${f.pauseReason ?? ""}` : t("q.o.pauseHint")}</p>
                {!f.isPaused && (
                  <input className="input-field mt-2" maxLength={200} value={pauseReason} placeholder={t("q.o.pauseReason")} onChange={(e) => setPauseReason(e.target.value)} />
                )}
                {f.isPaused ? (
                  <button className="btn-primary mt-2 w-full" disabled={saving} onClick={() => save({ paused: false }, "q.o.resumed")}>
                    {t("q.o.resume")}
                  </button>
                ) : (
                  <button
                    className="btn-secondary mt-2 w-full"
                    disabled={saving || pauseReason.trim().length < 3}
                    onClick={() => save({ paused: true, pauseReason: pauseReason.trim() }, "q.o.paused")}
                  >
                    {t("q.o.pause")}
                  </button>
                )}
              </div>
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
