import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";

interface Centre {
  id: string;
  name: string;
  location: string;
  district: string;
  state: string;
}

interface Slot {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  available: number;
  isFull: boolean;
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

export function SlotBooking() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [centres, setCentres] = useState<Centre[]>([]);
  const [crop, setCrop] = useState("Wheat");
  const [centreId, setCentreId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [quantityKg, setQuantityKg] = useState("");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Load centres once, and default to the first one so the page
  // isn't blank on first load.
  useEffect(() => {
    api.get("/centres").then((res) => {
      setCentres(res.data);
      if (res.data.length > 0) setCentreId(res.data[0].id);
    });
  }, []);

  // Re-fetch slots any time the centre or date changes.
  useEffect(() => {
    if (!centreId || !date) return;
    setSlotsLoading(true);
    setSelectedSlotId(null);
    setError(null);
    api
      .get("/slots", { params: { centreId, date } })
      .then((res) => setSlots(res.data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setSlotsLoading(false));
  }, [centreId, date]);

  async function handleBook() {
    if (!selectedSlotId) return;
    const qty = Number(quantityKg);
    if (!qty || qty <= 0) {
      setError(t("booking.qtyError"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post("/bookings", {
        slotId: selectedSlotId,
        crop,
        quantityKg: qty,
      });
      setConfirmation(res.data.booking);
    } catch (err) {
      setError(getErrorMessage(err));
      // Availability may have just changed — refresh the grid so the
      // farmer sees the real current state instead of a stale one.
      const res = await api.get("/slots", { params: { centreId, date } });
      setSlots(res.data);
      setSelectedSlotId(null);
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("booking.title")}</h1>
      <p className="mt-2 text-soil-light">{t("booking.subtitle")}</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="crop">{t("booking.crop")}</label>
          <select id="crop" className="input-field" value={crop} onChange={(e) => setCrop(e.target.value)}>
            <option>Wheat</option>
            <option>Paddy</option>
            <option>Maize</option>
            <option>Mustard</option>
            <option>Sugarcane</option>
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="centre">{t("booking.centre")}</label>
          <select
            id="centre"
            className="input-field"
            value={centreId}
            onChange={(e) => setCentreId(e.target.value)}
          >
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.district}
              </option>
            ))}
          </select>
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
            min={1}
            className="input-field"
            value={quantityKg}
            onChange={(e) => setQuantityKg(e.target.value)}
            placeholder="e.g. 500"
          />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-soil">{t("booking.availableSlots")}</h2>

        {slotsLoading && <p className="mt-3 text-sm text-soil-light">{t("slots.loading")}</p>}

        {!slotsLoading && slots.length === 0 && (
          <p className="mt-3 text-sm text-soil-light">{t("slots.none")}</p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {slots.map((slot) => {
            const isSelected = selectedSlotId === slot.id;
            return (
              <button
                key={slot.id}
                disabled={slot.isFull}
                onClick={() => setSelectedSlotId(slot.id)}
                className={[
                  "rounded-xl border-2 p-4 text-left transition",
                  slot.isFull
                    ? "cursor-not-allowed border-soil-light/15 bg-soil-light/5 opacity-60"
                    : isSelected
                    ? "border-field bg-field/5"
                    : "border-soil-light/25 bg-white hover:border-field",
                ].join(" ")}
              >
                <p className="font-display font-semibold text-soil">
                  {slot.startTime}–{slot.endTime}
                </p>
                <p className={`mt-1 text-xs font-medium ${slot.isFull ? "text-red-500" : "text-field"}`}>
                  {slot.isFull ? "FULL" : `Available: ${slot.available}/${slot.capacity}`}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <button
        className="btn-primary mt-8 w-full"
        disabled={!selectedSlotId || submitting}
        onClick={handleBook}
      >
        {submitting ? "…" : t("booking.confirm")}
      </button>
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
