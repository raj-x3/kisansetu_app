// One dashboard shared by the six desk officers. What each officer sees
// and can do is decided by CONFIG below. This is only for convenience:
// the backend independently refuses any action the role isn't allowed
// to perform, so changing this file can never grant extra powers.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { QualityCheckModal } from "../components/QualityCheckModal";
import { WeighingModal } from "../components/WeighingModal";
import { DocumentReviewModal } from "../components/DocumentReviewModal";
import { TimelineModal } from "../components/TimelineModal";
import { ScanModal } from "../components/ScanModal";
import { CapacityPanel } from "../components/CapacityPanel";
import { EmergencyReviewPanel } from "../components/EmergencyReviewPanel";
import { QueueControlPanel } from "../components/QueueControlPanel";
import { WaitlistManagementPanel } from "../components/WaitlistManagementPanel";
import type { OfficerRole, QueueRow } from "../types";

type Action = "arrive" | "verify" | "quality" | "weigh" | "complete" | "payment";

const CONFIG: Record<OfficerRole, { title: string; action: Action; show: (r: QueueRow) => boolean }> = {
  GATE_OFFICER: { title: "officer.gateTitle", action: "arrive", show: (r) => r.stage === "SLOT_BOOKED" },
  DOCUMENT_OFFICER: { title: "officer.documentTitle", action: "verify", show: (r) => r.stage === "ARRIVED" },
  QUALITY_OFFICER: { title: "officer.qualityTitle", action: "quality", show: (r) => r.stage === "VERIFIED" },
  WEIGHT_OFFICER: {
    title: "officer.weightTitle",
    action: "weigh",
    show: (r) => r.stage === "QUALITY_CHECKED" && r.qualityResult === "ACCEPTED",
  },
  PROCUREMENT_OFFICER: { title: "officer.procurementTitle", action: "complete", show: (r) => r.stage === "WEIGHED" },
  PAYMENT_OFFICER: {
    title: "officer.paymentTitle",
    action: "payment",
    show: (r) => r.stage === "COMPLETED" && r.paymentStatus !== null && r.paymentStatus !== "CREDITED" && r.paymentStatus !== "FAILED",
  },
};

const NEXT_PAYMENT: Record<string, "initiate" | "process" | "credit" | null> = {
  PENDING: "initiate",
  INITIATED: "process",
  PROCESSING: "credit",
  CREDITED: null,
  FAILED: null,
};

const ACTION_LABEL: Record<Action, string> = {
  arrive: "operator.markArrived",
  verify: "operator.markVerified",
  quality: "quality.title",
  weigh: "weigh.title",
  complete: "complete.action",
  payment: "payment.advance",
};

const STAGE_KEY: Record<string, string> = {
  SLOT_BOOKED: "stage.slotBooked",
  ARRIVED: "stage.arrived",
  VERIFIED: "stage.verified",
  QUALITY_CHECKED: "stage.qualityCheck",
  WEIGHED: "stage.weighed",
  COMPLETED: "stage.completed",
};

const PAYMENT_KEY: Record<string, string> = {
  PENDING: "payment.pending",
  INITIATED: "payment.initiated",
  PROCESSING: "payment.processing",
  CREDITED: "payment.credited",
  FAILED: "payment.failed",
};

export function OfficerDashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const config = CONFIG[user?.role as OfficerRole];

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [qualityId, setQualityId] = useState<string | null>(null);
  const [weighId, setWeighId] = useState<string | null>(null);
  const [docsId, setDocsId] = useState<string | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    api
      .get("/operator/today")
      .then((res) => {
        setRows(res.data.rows);
        if (res.data.centreId) socket.emit("join-centre", res.data.centreId);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    socket.on("stage-updated", load);
    socket.on("payment-updated", load);
    return () => {
      socket.off("stage-updated", load);
      socket.off("payment-updated", load);
    };
  }, [load]);

  if (!config) return null;

  const needle = filter.trim().toLowerCase();
  const waiting = rows.filter(config.show);
  const mine = needle
    ? waiting.filter(
        (r) =>
          r.caseId.toLowerCase().includes(needle) ||
          String(r.tokenNumber) === needle ||
          r.farmerName.toLowerCase().includes(needle) ||
          r.farmerCode.toLowerCase().includes(needle)
      )
    : waiting;

  async function post(url: string, bookingId: string) {
    setBusyId(bookingId);
    setError(null);
    try {
      await api.post(url);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function runAction(row: QueueRow) {
    switch (config.action) {
      case "arrive":
        return post(`/operator/arrive/${row.bookingId}`, row.bookingId);
      case "verify":
        return post(`/operator/verify/${row.bookingId}`, row.bookingId);
      case "quality":
        return setQualityId(row.bookingId);
      case "weigh":
        return setWeighId(row.bookingId);
      case "complete":
        return post(`/operator/complete/${row.bookingId}`, row.bookingId);
      case "payment": {
        const next = row.paymentStatus ? NEXT_PAYMENT[row.paymentStatus] : null;
        if (next) return post(`/operator/payment/${row.bookingId}/${next}`, row.bookingId);
      }
    }
  }

  const qualityRow = rows.find((r) => r.bookingId === qualityId) ?? null;
  const weighRow = rows.find((r) => r.bookingId === weighId) ?? null;
  const docsRow = rows.find((r) => r.bookingId === docsId) ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">{t(config.title as never)}</h1>
      <p className="mt-1 text-sm text-soil-light">{t("officer.subtitle")}</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-6 flex gap-2">
        <input
          className="input-field"
          placeholder={t("officer.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="btn-secondary whitespace-nowrap !px-4" onClick={() => setScanning(true)}>
          {t("scan.button")}
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
        {loading ? (
          <p className="p-6 text-sm text-soil-light">…</p>
        ) : mine.length === 0 ? (
          <p className="p-6 text-sm text-soil-light">{waiting.length > 0 ? t("officer.noMatch") : t("officer.emptyQueue")}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-soil-light/5 text-xs font-semibold text-soil-light">
              <tr>
                <th className="px-4 py-3">{t("operator.tableToken")}</th>
                <th className="px-4 py-3">{t("operator.tableFarmer")}</th>
                <th className="px-4 py-3">{t("operator.tableCrop")}</th>
                <th className="px-4 py-3">{t("operator.tableStage")}</th>
                <th className="px-4 py-3">{t("operator.tableAction")}</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((row) => (
                <tr key={row.bookingId} className="border-t border-soil-light/10">
                  <td className="px-4 py-3 font-display font-semibold text-field">{row.tokenNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-soil">{row.farmerName}</div>
                    <div className="text-xs text-soil-light">{row.farmerCode}</div>
                    <div className="text-xs text-soil-light">{row.caseId}</div>
                  </td>
                  <td className="px-4 py-3 text-soil-light">
                    {row.crop} · {row.quantityKg} kg
                  </td>
                  <td className="px-4 py-3 text-soil-light">
                    {t((STAGE_KEY[row.stage] ?? "stage.slotBooked") as never)}
                    {row.paymentStatus && (
                      <div className="mt-0.5 text-xs font-semibold text-wheat-dark">
                        {t(PAYMENT_KEY[row.paymentStatus] as never)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <button
                        className="rounded-lg bg-field px-3 py-1.5 text-xs font-semibold text-paper hover:bg-field-dark disabled:opacity-50"
                        onClick={() => runAction(row)}
                        disabled={busyId === row.bookingId}
                      >
                        {t(ACTION_LABEL[config.action] as never)}
                      </button>
                      <button
                        className="text-xs font-semibold text-soil-light underline"
                        onClick={() => setTimelineId(row.bookingId)}
                      >
                        {t("timeline.view")}
                      </button>
                      {config.action === "arrive" && (
                        <button
                          className="text-xs font-semibold text-red-600 underline"
                          onClick={() => {
                            if (window.confirm(t("officer.noShowConfirm"))) post(`/operator/no-show/${row.bookingId}`, row.bookingId);
                          }}
                        >
                          {t("officer.noShow")}
                        </button>
                      )}
                      {config.action === "verify" && (
                        <button
                          className="text-xs font-semibold text-sky underline"
                          onClick={() => setDocsId(row.bookingId)}
                        >
                          {t("doc.review")}
                        </button>
                      )}
                      {config.action === "payment" && (
                        <button
                          className="text-xs text-red-500 underline hover:text-red-700"
                          onClick={() => post(`/operator/payment/${row.bookingId}/fail`, row.bookingId)}
                        >
                          {t("payment.markFailed")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* The backend only allows the Procurement Officer (besides admin and manager) to change capacity. */}
      <CapacityPanel canConfigure={user?.role === "PROCUREMENT_OFFICER"} />

      {/* Only the document officer, manager and admin may review emergency requests (the server enforces it). */}
      {user?.role === "DOCUMENT_OFFICER" && <EmergencyReviewPanel />}

      {/* Everyone on the desk can see the live outlook; only admin, manager and operator may change centre status. */}
      <QueueControlPanel canControl={false} />

      {/* The procurement officer manages the waitlist (the server allows it for this role only, besides admin, manager and operator). */}
      {user?.role === "PROCUREMENT_OFFICER" && <WaitlistManagementPanel canSetWindow={false} />}

      {scanning && (
        <ScanModal
          onResult={(id) => {
            setFilter(id);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
      {timelineId && <TimelineModal bookingId={timelineId} onClose={() => setTimelineId(null)} />}
      {docsRow && <DocumentReviewModal row={docsRow} onClose={() => setDocsId(null)} />}
      {qualityRow && (
        <QualityCheckModal
          row={qualityRow}
          onClose={() => setQualityId(null)}
          onDone={() => {
            setQualityId(null);
            load();
          }}
        />
      )}
      {weighRow && (
        <WeighingModal
          row={weighRow}
          onClose={() => setWeighId(null)}
          onDone={() => {
            setWeighId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
