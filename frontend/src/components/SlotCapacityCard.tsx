// One slot's capacity for the chosen crop, as a card. Used on the booking
// page (recommended / alternative / not suitable) and nowhere else needs
// the numbers calculated: every figure here comes from the backend.

import { useLanguage } from "../context/LanguageContext";
import { kg } from "../utils/kg";
import type { CapacitySlot, CapacityStatus } from "../types";

const STATUS_KEY = {
  AVAILABLE: "cap.status.AVAILABLE",
  LIMITED: "cap.status.LIMITED",
  FULL: "cap.status.FULL",
} as const;

const STATUS_STYLE: Record<CapacityStatus, string> = {
  AVAILABLE: "bg-field/10 text-field",
  LIMITED: "bg-wheat-light/60 text-soil",
  FULL: "bg-red-50 text-red-600",
};

const BAR_STYLE: Record<CapacityStatus, string> = {
  AVAILABLE: "bg-field",
  LIMITED: "bg-wheat",
  FULL: "bg-red-400",
};

export function StatusBadge({ status }: { status: CapacityStatus }) {
  const { t } = useLanguage();
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {t(STATUS_KEY[status])}
    </span>
  );
}

export function UsageBar({ pct, status }: { pct: number; status: CapacityStatus }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-soil-light/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${BAR_STYLE[status]}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function reasonText(
  slot: CapacitySlot,
  weightKg: number | null,
  t: ReturnType<typeof useLanguage>["t"]
): string {
  const w = weightKg === null ? "" : kg(weightKg);
  switch (slot.reason) {
    case "bestFit":
      return t("cap.reason.bestFit").replace("{kg}", w);
    case "alsoFits":
      return t("cap.reason.alsoFits").replace("{kg}", w);
    case "tooSmall":
      return t("cap.reason.tooSmall").replace("{rem}", kg(slot.remainingKg)).replace("{kg}", w);
    case "full":
      return t("cap.reason.full");
    case "farmerCap":
      return t("cap.reason.farmerCap");
    default:
      return "";
  }
}

export function SlotCapacityCard({
  slot,
  weightKg,
  variant,
  busy,
  onBook,
}: {
  slot: CapacitySlot;
  weightKg: number | null;
  variant: "recommended" | "alternative" | "muted" | "info";
  busy?: boolean;
  onBook?: () => void;
}) {
  const { t } = useLanguage();
  const hero = variant === "recommended";
  const muted = variant === "muted";

  return (
    <div
      className={[
        "rounded-2xl border-2 p-4 sm:p-5",
        hero ? "border-field bg-field/5 shadow-sm" : muted ? "border-soil-light/15 bg-soil-light/5" : "border-soil-light/25 bg-white",
      ].join(" ")}
    >
      {hero && (
        <p className="mb-2 inline-block rounded-full bg-field px-3 py-1 text-xs font-bold uppercase tracking-wide text-paper">
          {t("cap.recommended")}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`font-display font-bold text-soil ${hero ? "text-2xl" : "text-lg"}`}>
          {slot.startTime} – {slot.endTime}
        </p>
        <StatusBadge status={slot.status} />
      </div>

      <div className="mt-3">
        <UsageBar pct={slot.utilizationPct} status={slot.status} />
        <p className="mt-1 text-xs text-soil-light">{t("cap.occupied").replace("{pct}", String(slot.utilizationPct))}</p>
      </div>

      <dl className={`mt-3 grid gap-x-4 gap-y-1 text-sm ${hero ? "sm:grid-cols-2" : "grid-cols-2"}`}>
        <Line label={t("cap.total")} value={`${kg(slot.maxWeightKg)} kg`} />
        <Line label={t("cap.booked")} value={`${kg(slot.bookedWeightKg)} kg`} />
        <Line label={t("cap.remaining")} value={`${kg(slot.remainingKg)} kg`} strong />
        {weightKg !== null && !muted && <Line label={t("cap.yourWeight")} value={`${kg(weightKg)} kg`} />}
        {slot.afterBookingKg !== null && (
          <Line label={t("cap.afterBooking")} value={`${kg(slot.afterBookingKg)} kg`} />
        )}
      </dl>

      {weightKg !== null && slot.reason !== "none" && (
        <p className={`mt-3 text-sm ${muted ? "text-soil-light" : "text-soil"}`}>{reasonText(slot, weightKg, t)}</p>
      )}

      {onBook && !muted && (
        <button className={`mt-4 w-full ${hero ? "btn-primary" : "btn-secondary"}`} disabled={busy} onClick={onBook}>
          {busy ? "…" : t("cap.bookThis")}
        </button>
      )}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-soil-light">{label}</dt>
      <dd className={strong ? "font-bold text-soil" : "font-medium text-soil"}>{value}</dd>
    </div>
  );
}
