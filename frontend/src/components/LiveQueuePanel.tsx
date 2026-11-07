// Farmer: the live queue.
//   1. "My wait": position and an ESTIMATED wait for the farmer's own booking,
//      shown as a range, with "until processing starts" and "until finished" apart.
//   2. "All centres": how busy every centre is right now.
// Everything comes from the backend (GET /queue/farmer/me and /queue/centres)
// and refreshes by itself when anything changes at the centre.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import { LEVEL_STYLE, rangeText } from "../utils/queue";
import type { CentreQueueSummary, FarmerQueueView, QueueLevel, WaitEstimate } from "../types";

export function LevelBadge({ level }: { level: QueueLevel }) {
  const { t } = useLanguage();
  const s = LEVEL_STYLE[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {t(s.key as any)}
    </span>
  );
}

// Five small bars: a quick picture of how busy it is, without any numbers to read.
function BusyBars({ level }: { level: QueueLevel }) {
  const filled = { LOW: 1, MODERATE: 3, HIGH: 5, DELAYED: 4, PAUSED: 0 }[level];
  const s = LEVEL_STYLE[level];
  return (
    <div className="flex items-end gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`w-2 rounded-sm ${i <= filled ? s.dot : "bg-soil-light/20"}`} style={{ height: 6 + i * 4 }} />
      ))}
    </div>
  );
}

function basisNote(est: WaitEstimate | null, t: (k: any) => string): string {
  if (!est) return "";
  return est.basis === "MEASURED" ? t("q.basisMeasured") : t("q.basisBaseline");
}

export function LiveQueuePanel() {
  const { t } = useLanguage();
  const [mine, setMine] = useState<FarmerQueueView | null>(null);
  const [centres, setCentres] = useState<CentreQueueSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCentres, setShowCentres] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([api.get("/queue/farmer/me"), api.get("/queue/centres")]);
      setMine(m.data);
      setCentres(c.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Listen to every centre shown, so the cards change the moment an officer acts.
  const ids = centres.map((c) => c.centreId).join(",");
  useEffect(() => {
    if (!ids) return;
    ids.split(",").forEach((id) => socket.emit("join-centre", id));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 400); // many events at once -> one reload
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
  }, [ids, load]);

  if (loading) return <p className="mt-6 text-sm text-soil-light">{t("q.loading")}</p>;

  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="font-display text-xl font-bold text-field">{t("q.title")}</h2>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {mine?.hasBooking && (
        <div className="card mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-soil">
              {mine.centreName} · {t("q.token")} {mine.yourToken}
            </p>
            <LevelBadge level={mine.level} />
          </div>

          {mine.isPaused && (
            <p className="mt-3 rounded-lg bg-soil-light/15 px-3 py-2 text-sm font-semibold text-soil">
              {t("q.pausedBanner")}
              {mine.pauseReason ? ` ${mine.pauseReason}` : ""}
            </p>
          )}
          {!mine.isPaused && mine.delayMinutes >= 10 && (
            <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700">
              {t("q.delayBanner").replace("{min}", String(mine.delayMinutes))}
            </p>
          )}

          {!mine.isToday ? (
            <p className="mt-3 text-sm text-soil-light">{t("q.notToday")}</p>
          ) : mine.estimate === null ? (
            <p className="mt-3 text-sm text-soil-light">{t("q.noEstimate")}</p>
          ) : (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t("q.nowServing")} value={String(mine.currentToken)} />
                <Stat label={t("q.farmersAhead")} value={String(mine.farmersAhead)} />
                <Stat label={t("q.untilStart")} value={rangeText(mine.estimate.startLowMin, mine.estimate.startHighMin, t)} />
                <Stat label={t("q.untilDone")} value={rangeText(mine.estimate.completeLowMin, mine.estimate.completeHighMin, t)} />
              </dl>
              <p className="mt-3 text-xs text-soil-light">
                {t("q.estimateNote")} {basisNote(mine.estimate, t)}{" "}
                {t("q.counters").replace("{n}", String(mine.counters))} {t("q.avg").replace("{min}", String(Math.round(mine.avgProcessingMin)))}
              </p>
            </>
          )}
        </div>
      )}
      {mine && !mine.hasBooking && <p className="mt-3 text-sm text-soil-light">{t("q.noBooking")}</p>}

      <button type="button" className="mt-4 text-sm font-semibold text-field underline" onClick={() => setShowCentres((v) => !v)}>
        {showCentres ? t("q.hideCentres") : t("q.showCentres")}
      </button>

      {showCentres && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {centres.map((c) => (
            <div key={c.centreId} className="card !p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold text-soil">{c.centreName}</p>
                  <p className="text-xs text-soil-light">{c.location}</p>
                </div>
                <BusyBars level={c.level} />
              </div>
              <div className="mt-2">
                <LevelBadge level={c.level} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label={t("q.nowServing")} value={String(c.currentToken)} small />
                <Stat label={t("q.waiting")} value={String(c.waiting)} small />
                <Stat label={t("q.processing")} value={String(c.processing)} small />
              </dl>
              {c.isPaused ? (
                <p className="mt-3 text-xs font-semibold text-soil">
                  {t("q.pausedBanner")} {c.pauseReason ?? ""}
                </p>
              ) : (
                <p className="mt-3 text-xs text-soil-light">
                  {t("q.newArrival").replace("{range}", rangeText(c.newArrival.startLowMin, c.newArrival.startHighMin, t))} ·{" "}
                  {t("q.avg").replace("{min}", String(Math.round(c.avgProcessingMin)))}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-wheat-light/20 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-soil-light">{label}</dt>
      <dd className={`font-display font-bold text-field ${small ? "text-lg" : "text-xl"}`}>{value}</dd>
    </div>
  );
}
