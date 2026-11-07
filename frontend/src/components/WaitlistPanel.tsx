// Farmer: waitlist entries, slot offers and history.
//
// An offer is NOT a booking. The backend holds the room for a limited time;
// the farmer accepts (booking is created) or declines. The countdown here is
// only a display: the server decides when an offer has really expired.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import { countdown, shortDate, useNow } from "../utils/queue";
import { kg } from "../utils/kg";
import type { FarmerWaitlist, SlotOfferView, WaitlistEntryView } from "../types";

export function WaitlistPanel({ onBookingChanged, reloadKey }: { onBookingChanged?: () => void; reloadKey?: number }) {
  const { t } = useLanguage();
  const now = useNow(1000);
  const [data, setData] = useState<FarmerWaitlist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/waitlist/me");
      setData(res.data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // The server pushes "offers-updated" to this farmer only (the personal room needs the login token).
  useEffect(() => {
    socket.emit("join-user", localStorage.getItem("token"));
    const refresh = () => void load();
    socket.on("offers-updated", refresh);
    socket.on("notification", refresh);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      socket.off("offers-updated", refresh);
      socket.off("notification", refresh);
      clearInterval(poll);
    };
  }, [load]);

  async function act(kind: "accept" | "decline", offer: SlotOfferView) {
    setBusy(offer.id);
    setError(null);
    setMessage(null);
    try {
      await api.post(`/slot-offers/${offer.id}/${kind}`);
      setMessage(kind === "accept" ? t("wl.accepted") : t("wl.declined"));
      if (kind === "accept") onBookingChanged?.();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function withdraw(e: WaitlistEntryView) {
    if (!window.confirm(t("wl.withdrawConfirm"))) return;
    setBusy(e.id);
    setError(null);
    setMessage(null);
    try {
      await api.delete(`/waitlist/${e.id}`);
      setMessage(t("wl.withdrawn"));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (!data) return error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null;

  // An offer whose time has run out on this screen is treated as over; the server has the final say.
  const pending = data.offers.filter((o) => o.status === "PENDING" && !countdown(o.expiresAt, now).over);
  const active = data.entries.filter((e) => e.status === "ACTIVE" || e.status === "OFFERED");
  const pastEntries = data.entries.filter((e) => e.status !== "ACTIVE" && e.status !== "OFFERED");
  const pastOffers = data.offers.filter((o) => !pending.includes(o));

  if (pending.length === 0 && active.length === 0 && pastEntries.length === 0 && pastOffers.length === 0 && !message && !error) return null;

  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="font-display text-xl font-bold text-field">{t("wl.title")}</h2>
      <p className="mt-1 text-sm text-soil-light">{t("wl.intro")}</p>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-3 rounded-lg border border-field/30 bg-field/10 px-4 py-3 text-sm font-semibold text-field">{message}</div>}

      {pending.map((o) => {
        const c = countdown(o.expiresAt, now);
        return (
          <div key={o.id} className="mt-4 rounded-2xl border-2 border-field bg-field/5 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-field">{t("wl.offerLabel")}</p>
            <p className="mt-1 font-display text-lg font-bold text-soil">
              {o.cropName} · {kg(o.quantityKg)}
            </p>
            <p className="text-sm text-soil">
              {o.centreName} · {shortDate(o.date)} · {o.startTime}–{o.endTime}
            </p>
            {o.remainingAfterKg !== null && (
              <p className="mt-1 text-xs text-soil-light">{t("wl.remainingAfter").replace("{kg}", kg(o.remainingAfterKg))}</p>
            )}
            <p className="mt-3 text-sm font-semibold text-soil">
              {t("wl.timeLeft")} <span className="font-display text-xl text-field">{c.text}</span>
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button className="btn-primary flex-1" disabled={busy === o.id} onClick={() => act("accept", o)}>
                {busy === o.id ? t("wl.working") : t("wl.accept")}
              </button>
              <button className="btn-secondary flex-1" disabled={busy === o.id} onClick={() => act("decline", o)}>
                {t("wl.decline")}
              </button>
            </div>
          </div>
        );
      })}

      {active.length > 0 && (
        <div className="mt-4 space-y-3">
          {active.map((e) => (
            <div key={e.id} className="card !p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold text-soil">
                    {e.cropName} · {kg(e.quantityKg)}
                  </p>
                  <p className="text-sm text-soil-light">
                    {e.centreName} · {shortDate(e.date)}
                    {e.windowStart && e.windowEnd ? ` · ${e.windowStart}–${e.windowEnd}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-wheat-light/50 px-2.5 py-1 text-xs font-semibold text-soil">
                  {e.status === "OFFERED" ? t("wl.status.OFFERED") : e.position ? t("wl.position").replace("{n}", String(e.position)) : t("wl.status.ACTIVE")}
                </span>
              </div>
              <button className="mt-3 text-sm font-semibold text-red-600 underline" disabled={busy === e.id} onClick={() => withdraw(e)}>
                {t("wl.withdraw")}
              </button>
            </div>
          ))}
        </div>
      )}

      {(pastEntries.length > 0 || pastOffers.length > 0) && (
        <>
          <button type="button" className="mt-4 text-sm font-semibold text-soil-light underline" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? t("wl.hideHistory") : t("wl.showHistory")}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-sm text-soil">
              {pastOffers.map((o) => (
                <li key={o.id} className="flex flex-wrap justify-between gap-2 border-b border-soil-light/10 py-1.5">
                  <span>
                    {o.cropName} {kg(o.quantityKg)} · {shortDate(o.date)} {o.startTime}–{o.endTime}
                  </span>
                  <span className="font-semibold text-soil-light">{t(`wl.offer.${o.status === "PENDING" ? "EXPIRED" : o.status}` as any)}</span>
                </li>
              ))}
              {pastEntries.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-soil-light/10 py-1.5">
                  <span>
                    {e.cropName} {kg(e.quantityKg)} · {e.centreName} · {shortDate(e.date)}
                  </span>
                  <span className="font-semibold text-soil-light">{t(`wl.status.${e.status}` as any)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
