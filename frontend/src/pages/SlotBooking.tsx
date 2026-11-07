import axios from "axios";
import { QrCode } from "../components/QrCode";
import { SlotCapacityCard } from "../components/SlotCapacityCard";
import { JoinWaitlistBox } from "../components/JoinWaitlistBox";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { kg } from "../utils/kg";
import type { Crop, Recommendation } from "../types";

interface Centre {
  id: string;
  name: string;
  location: string;
  district: string;
  state: string;
}

interface Confirmation {
  caseId: string;
  tokenNumber: number;
  centreName: string;
  date: string;
  startTime: string;
  endTime: string;
  crop: string;
  quantityKg: number;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(d: string) {
  return new Date(`${d}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function errorCode(err: unknown): string | null {
  return axios.isAxiosError(err) ? (err.response?.data?.code ?? null) : null;
}

// The booking page follows one fixed order: centre, crop, date, weight.
// Every slot card and every recommendation comes from the backend
// (GET /slots/recommend), recalculated from the live database each time
// something changes. The page never calculates availability itself.
export function SlotBooking() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [centres, setCentres] = useState<Centre[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [centreId, setCentreId] = useState("");
  const [cropId, setCropId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [weight, setWeight] = useState("");

  const [rec, setRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Only the newest request may update the screen, so a slow older
  // answer can never overwrite a newer one.
  const latestRequest = useRef(0);

  const crop = crops.find((c) => c.id === cropId) ?? null;
  const trimmed = weight.trim();
  const weightNum = trimmed === "" ? null : Number(trimmed);
  const weightIsNumber = weightNum !== null && Number.isFinite(weightNum);

  // Load centres and crops once. Both default to their first entry so the
  // page is never blank on first load.
  useEffect(() => {
    api
      .get("/centres")
      .then((res) => {
        setCentres(res.data);
        if (res.data.length > 0) setCentreId(res.data[0].id);
      })
      .catch((err) => setError(getErrorMessage(err)));
    api
      .get("/crops")
      .then((res) => {
        setCrops(res.data);
        if (res.data.length > 0) setCropId(res.data[0].id);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  const fetchRec = useCallback(
    async (silent: boolean) => {
      if (!centreId || !cropId || !date) return;
      if (weightNum !== null && !Number.isFinite(weightNum)) {
        setWeightError(t("booking.qtyError"));
        setRec(null);
        return;
      }
      const myRequest = ++latestRequest.current;
      if (!silent) setLoading(true);
      try {
        const res = await api.get("/slots/recommend", {
          params: { centreId, cropId, date, ...(weightNum !== null ? { weightKg: weightNum } : {}) },
        });
        if (myRequest !== latestRequest.current) return;
        setRec(res.data);
        setWeightError(null);
        setCheckedAt(new Date());
        if (!silent) setError(null);
      } catch (err) {
        if (myRequest !== latestRequest.current) return;
        const code = errorCode(err);
        if (code === "WEIGHT_INVALID" || code === "WEIGHT_TOO_HIGH") {
          setWeightError(getErrorMessage(err));
          setRec(null);
        } else {
          setError(getErrorMessage(err));
        }
      } finally {
        if (myRequest === latestRequest.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [centreId, cropId, date, weightNum, t]
  );

  // Recalculate whenever centre, crop, date or weight changes (a short
  // pause while typing, so we don't ask the server on every keystroke).
  useEffect(() => {
    const id = setTimeout(() => fetchRec(false), 400);
    return () => clearTimeout(id);
  }, [fetchRec]);

  // Keep the numbers fresh while the page stays open: every 30 seconds,
  // and when the farmer comes back to this tab.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") fetchRec(true);
    };
    const id = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchRec]);

  async function handleBook(slotId: string) {
    if (!weightIsNumber || weightNum === null || !cropId) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post("/bookings", { slotId, cropId, quantityKg: weightNum });
      setConfirmation(res.data.booking);
    } catch (err) {
      setError(getErrorMessage(err));
      const code = errorCode(err);
      if (code === "SLOT_FULL" || code === "SLOT_GONE") setNotice(t("cap.slotTaken"));
      // Availability may have just changed. Show the real current state.
      await fetchRec(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
        <div className="card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-field text-2xl text-paper">
            ✓
          </div>
          <h1 className="font-display text-2xl font-bold text-field">{t("booking.confirmed")}</h1>

          <div className="mt-6 rounded-xl bg-wheat-light/30 py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-soil-light">{t("booking.yourToken")}</p>
            <p className="font-display text-5xl font-bold text-soil">{confirmation.tokenNumber}</p>
            <p className="mt-2 text-xs text-soil-light">
              {t("case.id")}: <span className="font-semibold text-soil">{confirmation.caseId}</span>
            </p>
            <div className="mt-3 flex justify-center">
              <QrCode value={confirmation.caseId} size={140} />
            </div>
            <p className="mt-2 px-4 text-xs text-soil-light">{t("qr.hint")}</p>
          </div>

          <dl className="mt-6 space-y-2 text-left text-sm">
            <Row label={t("confirm.centre")} value={confirmation.centreName} />
            <Row label={t("confirm.date")} value={new Date(confirmation.date).toLocaleDateString()} />
            <Row label={t("confirm.time")} value={`${confirmation.startTime} – ${confirmation.endTime}`} />
            <Row label={t("confirm.crop")} value={confirmation.crop} />
            <Row label={t("confirm.quantity")} value={`${confirmation.quantityKg} kg`} />
          </dl>

          <button className="btn-primary mt-8 w-full" onClick={() => navigate("/farmer/dashboard")}>
            {t("confirm.goToDashboard")}
          </button>
        </div>
      </div>
    );
  }

  const recommended = rec?.slots.find((s) => s.rank === "RECOMMENDED") ?? null;
  const alternatives = rec?.slots.filter((s) => s.rank === "ALTERNATIVE") ?? [];
  const notSuitable = rec?.slots.filter((s) => s.rank === "NOT_SUITABLE") ?? [];
  const showRanked = rec !== null && rec.weightKg !== null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("booking.title")}</h1>
      <p className="mt-2 text-soil-light">{t("booking.subtitle")}</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="mt-4 rounded-lg border border-wheat bg-wheat-light/40 px-4 py-3 text-sm font-semibold text-soil">
          {notice}
        </div>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="centre">{t("booking.centre")}</label>
          <select id="centre" className="input-field" value={centreId} onChange={(e) => setCentreId(e.target.value)}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.district}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="crop">{t("booking.crop")}</label>
          <select id="crop" className="input-field" value={cropId} onChange={(e) => setCropId(e.target.value)}>
            {crops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {crops.length === 0 && <p className="mt-1 text-xs text-red-600">{t("cap.crop.none")}</p>}
        </div>

        <div>
          <label className="field-label" htmlFor="date">{t("booking.date")}</label>
          <input
            id="date"
            type="date"
            className="input-field"
            value={date}
            min={todayStr()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="quantity">{t("booking.quantity")}</label>
          <input
            id="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="input-field"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={t("cap.weight.placeholder")}
          />
          {crop && !weightError && (
            <p className="mt-1 text-xs text-soil-light">
              {t("cap.weight.hint").replace("{crop}", crop.name).replace("{max}", kg(crop.maxBookingKg))}
            </p>
          )}
          {weightError && <p className="mt-1 text-xs font-semibold text-red-600">{weightError}</p>}
        </div>
      </div>

      <div className="mt-8" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-soil">{t("booking.availableSlots")}</h2>
          <button type="button" className="text-sm font-semibold text-field underline" onClick={() => fetchRec(false)}>
            {t("cap.refresh")}
          </button>
        </div>

        {loading && <p className="mt-3 text-sm text-soil-light">{t("slots.loading")}</p>}

        {!loading && !weightError && rec && rec.slots.length === 0 && (
          <p className="mt-3 text-sm text-soil-light">{t("slots.none")}</p>
        )}

        {!loading && !weightError && rec && rec.weightKg === null && rec.slots.length > 0 && (
          <>
            <p className="mt-3 rounded-lg bg-wheat-light/30 px-3 py-2 text-sm text-soil">{t("cap.enterWeight")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {rec.slots.map((s) => (
                <SlotCapacityCard key={s.slotId} slot={s} weightKg={null} variant="info" />
              ))}
            </div>
          </>
        )}

        {!loading && !weightError && showRanked && rec && (
          <>
            {recommended ? (
              <div className="mt-4">
                <SlotCapacityCard
                  slot={recommended}
                  weightKg={rec.weightKg}
                  variant="recommended"
                  busy={submitting}
                  onBook={() => handleBook(recommended.slotId)}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-semibold">
                  {t("cap.noFit").replace("{kg}", kg(rec.weightKg ?? 0)).replace("{crop}", rec.cropName)}
                </p>
                {rec.alternativeDates.length > 0 ? (
                  <>
                    <p className="mt-3 font-semibold">{t("cap.tryDates")}</p>
                    <div className="mt-2 flex flex-col gap-2">
                      {rec.alternativeDates.map((a) => (
                        <button
                          key={a.date}
                          type="button"
                          className="btn-secondary w-full text-left"
                          onClick={() => setDate(a.date)}
                        >
                          {t("cap.dateOption")
                            .replace("{date}", prettyDate(a.date))
                            .replace("{time}", `${a.slot.startTime}–${a.slot.endTime}`)
                            .replace("{rem}", kg(a.slot.remainingKg))}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-2">{t("cap.noFitAnywhere")}</p>
                )}
              </div>
            )}

            {alternatives.length > 0 && (
              <>
                <h3 className="mt-6 font-display text-base font-semibold text-soil">{t("cap.alternatives")}</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {alternatives.map((s) => (
                    <SlotCapacityCard
                      key={s.slotId}
                      slot={s}
                      weightKg={rec.weightKg}
                      variant="alternative"
                      busy={submitting}
                      onBook={() => handleBook(s.slotId)}
                    />
                  ))}
                </div>
              </>
            )}

            {notSuitable.length > 0 && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm font-semibold text-soil-light">
                  {t("cap.notSuitable")} ({notSuitable.length})
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {notSuitable.map((s) => (
                    <SlotCapacityCard key={s.slotId} slot={s} weightKg={rec.weightKg} variant="muted" />
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {!loading && !weightError && showRanked && rec && rec.weightKg !== null && rec.slots.length > 0 && (
          <JoinWaitlistBox
            key={`${centreId}|${cropId}|${date}|${rec.weightKg}`}
            centreId={centreId}
            cropId={cropId}
            cropName={rec.cropName}
            date={date}
            weightKg={rec.weightKg}
            prominent={!recommended}
          />
        )}

        {checkedAt && !weightError && (
          <p className="mt-4 text-xs text-soil-light">
            {t("cap.checkedAt").replace("{time}", checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-soil-light/10 pb-2">
      <dt className="text-soil-light">{label}</dt>
      <dd className="font-medium text-soil">{value}</dd>
    </div>
  );
}
