import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { QualityCheckModal } from "../components/QualityCheckModal";
import { WeighingModal } from "../components/WeighingModal";
import type { QueueRow } from "../types";
import { TimelineModal } from "../components/TimelineModal";
import { ScanModal } from "../components/ScanModal";

const PAYMENT_LABEL_KEY: Record<string, any> = {
  PENDING: "payment.pending",
  INITIATED: "payment.initiated",
  PROCESSING: "payment.processing",
  CREDITED: "payment.credited",
  FAILED: "payment.failed",
};

const NEXT_PAYMENT_ACTION: Record<string, "initiate" | "process" | "credit" | null> = {
  PENDING: "initiate",
  INITIATED: "process",
  PROCESSING: "credit",
  CREDITED: null,
  FAILED: null,
};

interface Summary {
  total: number;
  waiting: number;
  arrived: number;
  verified: number;
  currentToken: number;
}

const STAGE_LABEL_KEY: Record<string, any> = {
  SLOT_BOOKED: "stage.slotBooked",
  ARRIVED: "stage.arrived",
  VERIFIED: "stage.verified",
  QUALITY_CHECKED: "stage.qualityCheck",
  WEIGHED: "stage.weighed",
  COMPLETED: "stage.completed",
};

export function OperatorQueue() {
  const { t } = useLanguage();

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<QueueRow[] | null>(null);

  const [callingNext, setCallingNext] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [qualityFormBookingId, setQualityFormBookingId] = useState<string | null>(null);
  const [weighFormBookingId, setWeighFormBookingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  function loadToday() {
    setLoading(true);
    setError(null);
    api
      .get("/operator/today")
      .then((res) => {
        setRows(res.data.rows);
        setSummary(res.data.summary);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadToday();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    const timeout = setTimeout(() => {
      api
        .get("/operator/search", { params: { q: trimmed } })
        .then((res) => setSearchResults(res.data.rows))
        .catch((err) => setError(getErrorMessage(err)));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  function refreshAfterAction() {
    loadToday();
    if (query.trim()) {
      api.get("/operator/search", { params: { q: query.trim() } }).then((res) => setSearchResults(res.data.rows));
    }
  }

  async function handleCallNext() {
    setCallingNext(true);
    setError(null);
    try {
      const res = await api.post("/queue/call-next");
      setSummary((s) => (s ? { ...s, currentToken: res.data.currentToken } : s));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCallingNext(false);
    }
  }

  async function handleAction(bookingId: string, action: "arrive" | "verify" | "no-show") {
    setActionLoadingId(bookingId);
    setError(null);
    try {
      await api.post(`/operator/${action}/${bookingId}`);
      refreshAfterAction();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleComplete(bookingId: string) {
    setCompletingId(bookingId);
    setError(null);
    try {
      await api.post(`/operator/complete/${bookingId}`);
      refreshAfterAction();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCompletingId(null);
    }
  }

  async function handleAdvancePayment(bookingId: string, action: "initiate" | "process" | "credit" | "fail") {
    setCompletingId(bookingId);
    setError(null);
    try {
      await api.post(`/operator/payment/${bookingId}/${action}`);
      refreshAfterAction();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCompletingId(null);
    }
  }

  const displayedRows = searchResults !== null ? searchResults : rows;
  const qualityFormRow = displayedRows.find((r) => r.bookingId === qualityFormBookingId) ?? null;
  const weighFormRow = displayedRows.find((r) => r.bookingId === weighFormBookingId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("operator.title")}</h1>
        <button className="btn-primary" onClick={handleCallNext} disabled={callingNext}>
          {callingNext ? t("operator.calling") : t("operator.callNext")}
        </button>
      </div>
      <p className="mt-1 text-sm text-soil-light">{t("operator.subtitle")}</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label={t("operator.currentToken")} value={summary?.currentToken ?? "—"} />
        <SummaryCard label={t("operator.todayTotal")} value={summary?.total ?? "—"} />
        <SummaryCard label={t("operator.waiting")} value={summary?.waiting ?? "—"} />
        <SummaryCard label={t("operator.arrived")} value={summary?.arrived ?? "—"} />
        <SummaryCard label={t("operator.verified")} value={summary?.verified ?? "—"} />
      </div>

      <div className="mt-6 flex gap-2">
        <input
          className="input-field"
          placeholder={t("operator.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn-secondary whitespace-nowrap !px-4" onClick={() => setScanning(true)}>
          {t("scan.button")}
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
        {loading ? (
          <p className="p-6 text-sm text-soil-light">…</p>
        ) : displayedRows.length === 0 ? (
          <p className="p-6 text-sm text-soil-light">
            {searchResults !== null ? t("operator.noResults") : "—"}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-soil-light/5 text-xs font-semibold uppercase tracking-wide text-soil-light">
              <tr>
                <th className="px-4 py-3">{t("operator.tableToken")}</th>
                <th className="px-4 py-3">{t("operator.tableFarmer")}</th>
                <th className="px-4 py-3">{t("operator.tableCrop")}</th>
                <th className="px-4 py-3">{t("operator.tableStage")}</th>
                <th className="px-4 py-3">{t("operator.tableAction")}</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row) => (
                <tr key={row.bookingId} className="border-t border-soil-light/10">
                  <td className="px-4 py-3 font-display font-semibold text-field">{row.tokenNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-soil">{row.farmerName}</div>
                    <div className="text-xs text-soil-light">{row.farmerCode}</div>
                    <div className="text-xs text-soil-light">{row.caseId}</div>
                    <button className="text-xs font-semibold text-sky underline" onClick={() => setTimelineId(row.bookingId)}>
                      {t("timeline.view")}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-soil-light">
                    {row.crop} · {row.quantityKg} kg
                  </td>
                  <td className="px-4 py-3 text-soil-light">
                    {t(STAGE_LABEL_KEY[row.stage] ?? "stage.slotBooked")}
                    {row.qualityResult && (
                      <div
                        className={`mt-0.5 text-xs font-semibold ${
                          row.qualityResult === "ACCEPTED" ? "text-field" : "text-red-600"
                        }`}
                      >
                        {t(row.qualityResult === "ACCEPTED" ? "quality.accepted" : "quality.rejected")}
                      </div>
                    )}
                    {row.netWeightKg !== null && !row.totalAmount && (
                      <div className="mt-0.5 text-xs font-semibold text-sky">
                        {t("weigh.netWeightBadge")}: {row.netWeightKg} kg
                      </div>
                    )}
                    {row.totalAmount !== null && (
                      <div className="mt-0.5 text-xs font-semibold text-field">
                        ₹{row.totalAmount} · {row.billReference}
                      </div>
                    )}
                    {row.paymentStatus && (
                      <div
                        className={`mt-0.5 text-xs font-semibold ${
                          row.paymentStatus === "CREDITED"
                            ? "text-field"
                            : row.paymentStatus === "FAILED"
                            ? "text-red-600"
                            : "text-wheat-dark"
                        }`}
                      >
                        {t(PAYMENT_LABEL_KEY[row.paymentStatus])}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.stage === "SLOT_BOOKED" && (
                      <button
                        className="rounded-lg bg-field px-3 py-1.5 text-xs font-semibold text-paper hover:bg-field-dark disabled:opacity-50"
                        onClick={() => handleAction(row.bookingId, "arrive")}
                        disabled={actionLoadingId === row.bookingId}
                      >
                        {t("operator.markArrived")}
                      </button>
                    )}
                    {row.stage === "SLOT_BOOKED" && (
                      <button
                        className="mt-1 block text-xs font-semibold text-red-600 underline"
                        onClick={() => {
                          if (window.confirm(t("officer.noShowConfirm"))) handleAction(row.bookingId, "no-show");
                        }}
                      >
                        {t("officer.noShow")}
                      </button>
                    )}
                    {row.stage === "ARRIVED" && (
                      <button
                        className="rounded-lg bg-wheat px-3 py-1.5 text-xs font-semibold text-soil hover:bg-wheat-dark disabled:opacity-50"
                        onClick={() => handleAction(row.bookingId, "verify")}
                        disabled={actionLoadingId === row.bookingId}
                      >
                        {t("operator.markVerified")}
                      </button>
                    )}
                    {row.stage === "VERIFIED" && (
                      <button
                        className="rounded-lg bg-sky px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90"
                        onClick={() => setQualityFormBookingId(row.bookingId)}
                      >
                        {t("quality.title")}
                      </button>
                    )}
                    {row.stage === "QUALITY_CHECKED" && row.qualityResult === "ACCEPTED" && (
                      <button
                        className="rounded-lg bg-sky px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90"
                        onClick={() => setWeighFormBookingId(row.bookingId)}
                      >
                        {t("weigh.title")}
                      </button>
                    )}
                    {row.stage === "QUALITY_CHECKED" && row.qualityResult === "REJECTED" && (
                      <span className="text-xs text-soil-light">—</span>
                    )}
                    {row.stage === "WEIGHED" && (
                      <button
                        className="rounded-lg bg-field px-3 py-1.5 text-xs font-semibold text-paper hover:bg-field-dark disabled:opacity-50"
                        onClick={() => handleComplete(row.bookingId)}
                        disabled={completingId === row.bookingId}
                      >
                        {t("complete.action")}
                      </button>
                    )}
                    {row.stage === "COMPLETED" && row.paymentStatus && (
                      <div className="flex flex-col items-start gap-1">
                        {NEXT_PAYMENT_ACTION[row.paymentStatus] && (
                          <button
                            className="rounded-lg bg-field px-3 py-1.5 text-xs font-semibold text-paper hover:bg-field-dark disabled:opacity-50"
                            onClick={() =>
                              handleAdvancePayment(row.bookingId, NEXT_PAYMENT_ACTION[row.paymentStatus!]!)
                            }
                            disabled={completingId === row.bookingId}
                          >
                            {t("payment.advance")}
                          </button>
                        )}
                        {row.paymentStatus !== "CREDITED" && row.paymentStatus !== "FAILED" && (
                          <button
                            className="text-xs text-red-500 underline hover:text-red-700"
                            onClick={() => handleAdvancePayment(row.bookingId, "fail")}
                          >
                            {t("payment.markFailed")}
                          </button>
                        )}
                        {(row.paymentStatus === "CREDITED" || row.paymentStatus === "FAILED") && (
                          <span className="text-xs text-soil-light">—</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {scanning && (
        <ScanModal
          onResult={(id) => {
            setQuery(id);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
      {timelineId && <TimelineModal bookingId={timelineId} onClose={() => setTimelineId(null)} />}

      {qualityFormRow && (
        <QualityCheckModal
          row={qualityFormRow}
          onClose={() => setQualityFormBookingId(null)}
          onDone={() => {
            setQualityFormBookingId(null);
            refreshAfterAction();
          }}
        />
      )}

      {weighFormRow && (
        <WeighingModal
          row={weighFormRow}
          onClose={() => setWeighFormBookingId(null)}
          onDone={() => {
            setWeighFormBookingId(null);
            refreshAfterAction();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card !p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-soil-light">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-field">{value}</p>
    </div>
  );
}
