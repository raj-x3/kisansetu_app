// A pop-up showing one case's history, oldest first. Data comes from
// GET /cases/:id/timeline, which only returns what this user may see.

import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { describeDetails } from "../utils/auditText";

interface TimelineEvent {
  id: string;
  action: string;
  at: string;
  actorRole: string;
  actorName: string | null;
  details: Record<string, string | number | boolean>;
}

interface Timeline {
  caseId: string;
  tokenNumber: number;
  crop: string;
  quantityKg: number;
  centreName: string;
  events: TimelineEvent[];
}

const STAFF_ROLES = [
  "MANAGER",
  "GATE_OFFICER",
  "DOCUMENT_OFFICER",
  "QUALITY_OFFICER",
  "WEIGHT_OFFICER",
  "PROCUREMENT_OFFICER",
  "PAYMENT_OFFICER",
];

export function TimelineModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const tt = t as unknown as (key: string) => string;
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(`/cases/${bookingId}/timeline`)
      .then((res) => setData(res.data))
      .catch((err) => setError(getErrorMessage(err)));
  }, [bookingId]);

  function roleLabel(role: string): string {
    return tt(STAFF_ROLES.includes(role) ? `staff.role.${role}` : `timeline.role.${role}`);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-field">{t("timeline.title")}</h2>
        {data && (
          <p className="mt-1 text-sm text-soil-light">
            {t("case.id")}: {data.caseId} · {t("operator.tableToken")} {data.tokenNumber} · {data.crop}, {data.quantityKg} kg ·{" "}
            {data.centreName}
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        {!data && !error && <p className="mt-4 text-sm text-soil-light">…</p>}
        {data && data.events.length === 0 && <p className="mt-4 text-sm text-soil-light">{t("timeline.empty")}</p>}

        {data && data.events.length > 0 && (
          <ol className="mt-5 border-l-2 border-field/30 pl-5">
            {data.events.map((ev) => {
              const detail = describeDetails(ev.details, tt);
              const who = ev.actorName ? `${ev.actorName} (${roleLabel(ev.actorRole)})` : roleLabel(ev.actorRole);
              return (
                <li key={ev.id} className="relative pb-5 last:pb-0">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-field" />
                  <p className="text-sm font-semibold text-soil">{tt(`audit.act.${ev.action}`)}</p>
                  {detail && <p className="text-xs text-soil-light">{detail}</p>}
                  <p className="text-xs text-soil-light">
                    {new Date(ev.at).toLocaleString()} · {t("timeline.by").replace("{who}", who)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <button className="btn-secondary mt-6 w-full" onClick={onClose}>
          {t("doc.close")}
        </button>
      </div>
    </div>
  );
}
