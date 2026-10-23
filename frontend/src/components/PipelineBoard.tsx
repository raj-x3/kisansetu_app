// A live "where is everyone?" board for the Manager.
// Shows how many of today's cases sit at each stage; tap a stage to
// list those cases. It only READS from the backend (/operator/today)
// and refreshes itself whenever the server announces a change.

import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import type { QueueRow } from "../types";

const STAGES: { key: string; label: string }[] = [
  { key: "SLOT_BOOKED", label: "stage.slotBooked" },
  { key: "ARRIVED", label: "stage.arrived" },
  { key: "VERIFIED", label: "stage.verified" },
  { key: "QUALITY_CHECKED", label: "stage.qualityCheck" },
  { key: "WEIGHED", label: "stage.weighed" },
  { key: "COMPLETED", label: "stage.completed" },
];

export function PipelineBoard() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let centreId: string | null = null;
    let cancelled = false;

    function load() {
      api
        .get("/operator/today")
        .then((res) => {
          if (cancelled) return;
          setRows(res.data.rows);
          if (res.data.centreId && res.data.centreId !== centreId) {
            centreId = res.data.centreId;
            socket.emit("join-centre", centreId);
          }
        })
        .catch((err) => !cancelled && setError(getErrorMessage(err)));
    }

    load();
    socket.on("stage-updated", load);
    socket.on("payment-updated", load);
    return () => {
      cancelled = true;
      socket.off("stage-updated", load);
      socket.off("payment-updated", load);
    };
  }, []);

  const inStage = (key: string) => rows.filter((r) => r.stage === key);
  const selectedRows = selected ? inStage(selected) : [];

  return (
    <div className="mt-6 rounded-xl border border-soil-light/20 bg-white p-4">
      <h2 className="font-display text-lg font-bold text-field">{t("manager.pipeline")}</h2>
      <p className="mt-1 text-sm text-soil-light">{t("manager.pipelineHint")}</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((st) => (
          <button
            key={st.key}
            onClick={() => setSelected(selected === st.key ? null : st.key)}
            className={`rounded-xl border p-3 text-left transition ${
              selected === st.key ? "border-sky bg-sky/10" : "border-soil-light/20 hover:border-sky"
            }`}
          >
            <p className="text-xs font-semibold text-soil-light">{t(st.label as never)}</p>
            <p className="mt-1 font-display text-2xl font-bold text-field">{inStage(st.key).length}</p>
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-soil-light/20">
          {selectedRows.length === 0 ? (
            <p className="p-4 text-sm text-soil-light">{t("manager.noCases")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody>
                {selectedRows.map((r) => (
                  <tr key={r.bookingId} className="border-t border-soil-light/10 first:border-t-0">
                    <td className="px-3 py-2 font-display font-semibold text-field">{r.tokenNumber}</td>
                    <td className="px-3 py-2 text-xs text-soil-light">{r.caseId}</td>
                    <td className="px-3 py-2 text-soil">{r.farmerName}</td>
                    <td className="px-3 py-2 text-soil-light">
                      {r.crop} · {r.quantityKg} kg
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
