import { useEffect, useState, ReactElement } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { PipelineBoard } from "../components/PipelineBoard";
import { StaffForm } from "../components/StaffForm";

interface Analytics {
  filtersApplied: boolean;
  summary: {
    totalFarmers: number;
    activeCentres: number;
    todaysBookings: number;
    farmersWaiting: number;
    completedProcurement: number;
    totalQuantityKg: number;
    totalValue: number;
    pendingPayments: number;
    completedPayments: number;
  };
  charts: {
    bookingsPerCentre: { name: string; count: number }[];
    quantityPerCentre: { name: string; kg: number }[];
    stages: { stage: string; count: number }[];
    paymentStatus: { status: string; count: number }[];
  };
}

interface Centre {
  id: string;
  name: string;
  location: string;
  district: string;
  state: string;
  dailyCapacity: number;
  operatingStart: string;
  operatingEnd: string;
  numMachines: number;
  numOperators: number;
  isActive: boolean;
}

interface CentreForecast {
  centreId: string;
  centreName: string;
  capacity: number;
  expectedFarmers: number;
  overload: boolean;
}

interface Insight {
  type: string;
  params: Record<string, string | number>;
}

interface AuditRow {
  id: string;
  actorRole: string;
  actorName: string;
  action: string;
  details: { token?: number; result?: string; kg?: number; amount?: number; name?: string; active?: boolean; docType?: string; docStatus?: string; staffRole?: string } | null;
  createdAt: string;
}

const STAGE_KEY: Record<string, any> = {
  SLOT_BOOKED: "stage.slotBooked",
  ARRIVED: "stage.arrived",
  VERIFIED: "stage.verified",
  QUALITY_CHECKED: "stage.qualityCheck",
  WEIGHED: "stage.weighed",
  COMPLETED: "stage.completed",
};

const PAYMENT_KEY: Record<string, any> = {
  PENDING: "payment.pending",
  INITIATED: "payment.initiated",
  PROCESSING: "payment.processing",
  CREDITED: "payment.credited",
  FAILED: "payment.failed",
};

const PAYMENT_COLOR: Record<string, string> = {
  PENDING: "#D9A441",
  INITIATED: "#2F6690",
  PROCESSING: "#8A7358",
  CREDITED: "#1F4B3F",
  FAILED: "#DC2626",
};

const FIELD = "#1F4B3F";
const SKY = "#2F6690";

export function AdminDashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // The Manager sees the same analytics, but also gets queue controls and
  // the live pipeline — and never the admin-only simulation or Add Centre.
  const isManager = user?.role === "MANAGER";
  const [nowServing, setNowServing] = useState<number | null>(null);
  const [calling, setCalling] = useState(false);

  async function managerCallNext() {
    setCalling(true);
    setError(null);
    try {
      const res = await api.post("/queue/call-next");
      setNowServing(res.data.currentToken);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCalling(false);
    }
  }
  const [data, setData] = useState<Analytics | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [forecast, setForecast] = useState<CentreForecast[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [simCentreId, setSimCentreId] = useState<string>("");
  const [simBusy, setSimBusy] = useState<string | null>(null);
  const [simFeedback, setSimFeedback] = useState<string | null>(null);
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterCentreId, setFilterCentreId] = useState("");
  const [filterCrop, setFilterCrop] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Centre | "new" | null>(null);

  function load() {
    setError(null);
    const analyticsParams: Record<string, string> = {};
    if (filterStartDate) analyticsParams.startDate = filterStartDate;
    if (filterEndDate) analyticsParams.endDate = filterEndDate;
    if (filterCentreId) analyticsParams.centreId = filterCentreId;
    if (filterCrop) analyticsParams.crop = filterCrop;
    if (filterDistrict) analyticsParams.district = filterDistrict;

    Promise.all([
      api.get("/admin/analytics", { params: analyticsParams }),
      api.get("/admin/centres"),
      api.get("/admin/audit-logs"),
      api.get("/admin/insights"),
    ])
      .then(([analyticsRes, centresRes, auditRes, insightsRes]) => {
        setData(analyticsRes.data);
        setCentres(centresRes.data);
        setAudit(auditRes.data);
        setForecast(insightsRes.data.forecast);
        setInsights(insightsRes.data.insights);
        setSimCentreId((prev) => prev || centresRes.data[0]?.id || "");
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  function clearFilters() {
    setFilterStartDate("");
    setFilterEndDate("");
    setFilterCentreId("");
    setFilterCrop("");
    setFilterDistrict("");
    // Re-run load() right after the state above actually updates, not
    // against this render's still-stale closure values.
    setTimeout(load, 0);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(centre: Centre) {
    setError(null);
    try {
      await api.put(`/admin/centres/${centre.id}`, { isActive: !centre.isActive });
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) return <p className="mx-auto max-w-6xl px-4 py-12 text-soil-light">…</p>;

  // Turns the stored, language-neutral facts into text in the viewer's language.
  function renderDetails(d: AuditRow["details"]): string {
    if (!d) return "—";
    const parts: string[] = [];
    if (d.token !== undefined) parts.push(`#${d.token}`);
    if (d.name) parts.push(d.name);
    if (d.active !== undefined) parts.push(d.active ? t("admin.active") : t("admin.inactive"));
    if (d.result) parts.push(t(d.result === "ACCEPTED" ? "quality.accepted" : "quality.rejected"));
    if (d.staffRole) parts.push(t(`staff.role.${d.staffRole}` as any));
    if (d.docType) parts.push(t(`doc.type.${d.docType}` as any));
    if (d.docStatus) parts.push(t(`doc.status.${d.docStatus}` as any));
    if (d.kg !== undefined) parts.push(`${d.kg} kg`);
    if (d.amount !== undefined) parts.push(`₹${d.amount}`);
    return parts.join(" · ") || "—";
  }

  // Fills a translated insight template with its stored, language-neutral values.
  // "stage" is translated through the existing stage.* keys first, since
  // it's a raw enum from the database, not player-facing text.
  function renderInsight(insight: Insight): string {
    const template = t(`insights.${insight.type}` as any);
    const params = { ...insight.params };
    if (typeof params.stage === "string") {
      params.stage = t(STAGE_KEY[params.stage] ?? "stage.slotBooked");
    }
    return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));
  }

  const INSIGHT_TONE: Record<string, string> = {
    demandOverload: "border-wheat-dark bg-wheat-light/20 text-soil",
    highCongestion: "border-red-200 bg-red-50 text-red-700",
    slowStage: "border-red-200 bg-red-50 text-red-700",
    paymentBacklog: "border-wheat-dark bg-wheat-light/20 text-soil",
    spareCapacity: "border-field/20 bg-field/5 text-field",
  };
  const INSIGHT_ICON: Record<string, string> = {
    demandOverload: "⚠️",
    highCongestion: "⚠️",
    slowStage: "⚠️",
    paymentBacklog: "⚠️",
    spareCapacity: "🟢",
  };

  const PAYMENT_STATUS_KEY: Record<string, any> = {
    PENDING: "payment.pending", INITIATED: "payment.initiated", PROCESSING: "payment.processing",
    CREDITED: "payment.credited", FAILED: "payment.failed",
  };

  async function runSim(action: string, endpoint: string, body: Record<string, unknown> = {}) {
    if (!simCentreId) return;
    setSimBusy(action);
    setSimFeedback(null);
    setError(null);
    try {
      const res = await api.post(`/admin/simulate/${endpoint}`, { centreId: simCentreId, ...body });
      if (endpoint === "add-farmers" || endpoint === "congestion") {
        setSimFeedback(t("sim.added").replace("{added}", String(res.data.added)).replace("{requested}", String(res.data.requested)));
      } else if (endpoint === "complete-stage") {
        setSimFeedback(
          t("sim.stageAdvanced")
            .replace("{token}", String(res.data.tokenNumber))
            .replace("{from}", t(STAGE_KEY[res.data.fromStage] ?? "stage.slotBooked"))
            .replace("{to}", t(STAGE_KEY[res.data.toStage] ?? "stage.slotBooked"))
        );
      } else if (endpoint === "payment") {
        setSimFeedback(
          t("sim.paymentAdvanced")
            .replace("{token}", String(res.data.tokenNumber))
            .replace("{status}", t(PAYMENT_STATUS_KEY[res.data.toStatus] ?? "payment.pending"))
        );
      } else if (endpoint === "reset") {
        setSimFeedback(t("sim.resetDone").replace("{count}", String(res.data.farmersRemoved)));
      }
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSimBusy(null);
    }
  }

  const s = data?.summary;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-field sm:text-3xl">
          {isManager ? t("manager.title") : t("admin.title")}
        </h1>
        {isManager && (
          <button className="btn-primary" onClick={managerCallNext} disabled={calling}>
            {calling ? t("operator.calling") : t("operator.callNext")}
          </button>
        )}
      </div>

      {isManager && nowServing !== null && (
        <p className="mt-3 rounded-lg bg-field/10 px-3 py-2 text-sm font-semibold text-field">
          {t("manager.nowServing").replace("{token}", String(nowServing))}
        </p>
      )}

      {isManager && <PipelineBoard />}

      {!isManager && (
      <div className="mt-6 rounded-2xl border-2 border-dashed border-wheat-dark/50 bg-wheat-light/10 p-5">
        <h2 className="font-display text-lg font-bold text-soil">{t("sim.title")}</h2>
        <p className="mt-1 text-sm text-soil-light">{t("sim.subtitle")}</p>

        <div className="mt-4">
          <label className="field-label">{t("sim.selectCentre")}</label>
          <select className="input-field max-w-xs" value={simCentreId} onChange={(e) => setSimCentreId(e.target.value)}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {simFeedback && (
          <p className="mt-3 rounded-lg bg-field/10 px-3 py-2 text-sm font-semibold text-field">{simFeedback}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <SimButton label={t("sim.add10")} busy={simBusy === "add10"} onClick={() => runSim("add10", "add-farmers", { count: 10 })} />
          <SimButton label={t("sim.add20")} busy={simBusy === "add20"} onClick={() => runSim("add20", "add-farmers", { count: 20 })} />
          <SimButton label={t("sim.congestion")} busy={simBusy === "congestion"} onClick={() => runSim("congestion", "congestion")} />
          <SimButton label={t("sim.completeStage")} busy={simBusy === "complete-stage"} onClick={() => runSim("complete-stage", "complete-stage")} />
          <SimButton label={t("sim.payment")} busy={simBusy === "payment"} onClick={() => runSim("payment", "payment")} />
        </div>

        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {t("sim.warningCallNext")}
        </div>
        <div className="mt-2">
          <SimButton label={t("sim.callNext")} busy={simBusy === "call-next"} tone="danger" onClick={() => runSim("call-next", "call-next")} />
        </div>

        <div className="mt-4 border-t border-wheat-dark/30 pt-3">
          <button
            className="text-xs font-semibold text-red-600 underline"
            onClick={() => {
              if (window.confirm(t("sim.resetConfirm"))) runSim("reset", "reset");
            }}
            disabled={simBusy === "reset"}
          >
            {t("sim.reset")}
          </button>
        </div>
      </div>
      )}


      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {s && (
        <>
        <div className="mt-6 rounded-xl border border-soil-light/20 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-soil-light">{t("admin.filters")}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <label className="field-label">{t("admin.startDate")}</label>
              <input type="date" className="input-field" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">{t("admin.endDate")}</label>
              <input type="date" className="input-field" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">{t("confirm.centre")}</label>
              <select className="input-field" value={filterCentreId} onChange={(e) => setFilterCentreId(e.target.value)}>
                <option value="">{t("admin.allCentres")}</option>
                {centres.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">{t("booking.crop")}</label>
              <select className="input-field" value={filterCrop} onChange={(e) => setFilterCrop(e.target.value)}>
                <option value="">{t("admin.allCrops")}</option>
                <option>Wheat</option>
                <option>Paddy</option>
                <option>Maize</option>
                <option>Mustard</option>
                <option>Sugarcane</option>
              </select>
            </div>
            <div>
              <label className="field-label">{t("register.district")}</label>
              <input className="input-field" value={filterDistrict} onChange={(e) => setFilterDistrict(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary !px-4 !py-2 text-xs" onClick={load}>{t("admin.apply")}</button>
            <button className="btn-secondary !px-4 !py-2 text-xs" onClick={clearFilters}>{t("admin.clear")}</button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label={t("admin.totalFarmers")} value={s.totalFarmers} />
          <Stat label={t("admin.activeCentres")} value={s.activeCentres} />
          <Stat label={data?.filtersApplied ? t("admin.filteredBookings") : t("admin.todayBookings")} value={s.todaysBookings} />
          <Stat label={t("admin.farmersWaiting")} value={s.farmersWaiting} />
          <Stat label={t("admin.completedProcurement")} value={s.completedProcurement} />
          <Stat label={t("admin.totalQuantity")} value={Math.round(s.totalQuantityKg).toLocaleString()} />
          <Stat label={t("admin.totalValue")} value={Math.round(s.totalValue).toLocaleString()} />
          <Stat label={t("admin.pendingPayments")} value={s.pendingPayments} />
          <Stat label={t("admin.completedPayments")} value={s.completedPayments} />
        </div>
        </>
      )}

      {data && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <ChartCard title={t("admin.chartBookings")}>
            <BarChart data={data.charts.bookingsPerCentre}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill={FIELD} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title={t("admin.chartQuantity")}>
            <BarChart data={data.charts.quantityPerCentre}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="kg" fill={SKY} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title={t("admin.chartStages")}>
            <BarChart data={data.charts.stages.map((x) => ({ name: t(STAGE_KEY[x.stage] ?? "stage.slotBooked"), count: x.count }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#D9A441" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title={t("admin.chartPayments")}>
            <PieChart>
              <Pie
                data={data.charts.paymentStatus.map((x) => ({ name: t(PAYMENT_KEY[x.status]), value: x.count, status: x.status }))}
                dataKey="value"
                nameKey="name"
                outerRadius={80}
                label
              >
                {data.charts.paymentStatus.map((x) => (
                  <Cell key={x.status} fill={PAYMENT_COLOR[x.status]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ChartCard>
        </div>
      )}

      <h2 className="mt-10 font-display text-xl font-bold text-field">{t("insights.title")}</h2>
      <div className="mt-4 space-y-2">
        {insights.length === 0 ? (
          <p className="rounded-xl border border-field/20 bg-field/5 px-4 py-3 text-sm text-field">
            🟢 {t("insights.empty")}
          </p>
        ) : (
          insights.map((ins, i) => (
            <p key={i} className={`rounded-xl border px-4 py-3 text-sm ${INSIGHT_TONE[ins.type] ?? "border-soil-light/20 bg-white text-soil"}`}>
              {INSIGHT_ICON[ins.type] ?? "ℹ️"} {renderInsight(ins)}
            </p>
          ))
        )}
      </div>

      <h2 className="mt-8 font-display text-xl font-bold text-field">{t("insights.forecastTitle")}</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-soil-light/5 text-xs font-semibold uppercase tracking-wide text-soil-light">
            <tr>
              <th className="px-4 py-3">{t("admin.name")}</th>
              <th className="px-4 py-3">{t("insights.expectedTomorrow")}</th>
              <th className="px-4 py-3">{t("admin.dailyCapacity")}</th>
              <th className="px-4 py-3">{t("operator.tableStage")}</th>
            </tr>
          </thead>
          <tbody>
            {forecast.map((f) => (
              <tr key={f.centreId} className="border-t border-soil-light/10">
                <td className="px-4 py-3 font-medium text-soil">{f.centreName}</td>
                <td className="px-4 py-3 text-soil-light">{Math.round(f.expectedFarmers)}</td>
                <td className="px-4 py-3 text-soil-light">{f.capacity}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold ${f.overload ? "text-red-600" : "text-field"}`}>
                    {f.overload ? t("insights.overload") : t("insights.ok")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-field">{t("admin.centres")}</h2>
        {!isManager && (
          <button className="btn-primary !py-2.5 text-sm" onClick={() => setEditing("new")}>
            + {t("admin.addCentre")}
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-soil-light/5 text-xs font-semibold uppercase tracking-wide text-soil-light">
            <tr>
              <th className="px-4 py-3">{t("admin.name")}</th>
              <th className="px-4 py-3">{t("register.district")}</th>
              <th className="px-4 py-3">{t("admin.dailyCapacity")}</th>
              <th className="px-4 py-3">{t("admin.machines")} / {t("admin.operators")}</th>
              <th className="px-4 py-3">{t("admin.opStart")}–{t("admin.opEnd")}</th>
              <th className="px-4 py-3">{t("operator.tableStage")}</th>
              <th className="px-4 py-3">{t("operator.tableAction")}</th>
            </tr>
          </thead>
          <tbody>
            {centres.map((c) => (
              <tr key={c.id} className="border-t border-soil-light/10">
                <td className="px-4 py-3">
                  <div className="font-medium text-soil">{c.name}</div>
                  <div className="text-xs text-soil-light">{c.location}</div>
                </td>
                <td className="px-4 py-3 text-soil-light">{c.district}</td>
                <td className="px-4 py-3 text-soil-light">{c.dailyCapacity}</td>
                <td className="px-4 py-3 text-soil-light">{c.numMachines} / {c.numOperators}</td>
                <td className="px-4 py-3 text-soil-light">{c.operatingStart}–{c.operatingEnd}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold ${c.isActive ? "text-field" : "text-red-600"}`}>
                    {c.isActive ? t("admin.active") : t("admin.inactive")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 text-xs font-semibold">
                    <button className="text-sky underline" onClick={() => setEditing(c)}>
                      {t("admin.edit")}
                    </button>
                    <button
                      className={c.isActive ? "text-red-600 underline" : "text-field underline"}
                      onClick={() => toggleActive(c)}
                    >
                      {c.isActive ? t("admin.disable") : t("admin.enable")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isManager && <StaffForm centres={centres} />}

      <h2 className="mt-12 font-display text-xl font-bold text-field">{t("audit.title")}</h2>
      <p className="mt-1 text-xs text-soil-light">{t("audit.note")}</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
        {audit.length === 0 ? (
          <p className="p-6 text-sm text-soil-light">{t("audit.empty")}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-soil-light/5 text-xs font-semibold uppercase tracking-wide text-soil-light">
              <tr>
                <th className="px-4 py-3">{t("audit.time")}</th>
                <th className="px-4 py-3">{t("audit.actor")}</th>
                <th className="px-4 py-3">{t("audit.action")}</th>
                <th className="px-4 py-3">{t("audit.details")}</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-soil-light/10">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-soil-light">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-soil">{a.actorName}</div>
                    <div className="text-[10px] uppercase tracking-wide text-soil-light">{a.actorRole}</div>
                  </td>
                  <td className="px-4 py-3 text-soil">{t(`audit.act.${a.action}` as any)}</td>
                  <td className="px-4 py-3 text-soil-light">{renderDetails(a.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <CentreForm
          centre={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SimButton({
  label,
  onClick,
  busy,
  tone = "primary",
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  tone?: "primary" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
        tone === "danger" ? "bg-red-600 text-white hover:bg-red-700" : "bg-field text-paper hover:bg-field-dark"
      }`}
    >
      {busy ? "…" : label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card !p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-soil-light">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-field">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactElement }) {
  return (
    <div className="card">
      <h3 className="font-display text-sm font-semibold text-soil">{title}</h3>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CentreForm({
  centre,
  onClose,
  onSaved,
}: {
  centre: Centre | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: centre?.name ?? "",
    location: centre?.location ?? "",
    district: centre?.district ?? "",
    state: centre?.state ?? "",
    dailyCapacity: String(centre?.dailyCapacity ?? 200),
    operatingStart: centre?.operatingStart ?? "09:00",
    operatingEnd: centre?.operatingEnd ?? "17:00",
    numMachines: String(centre?.numMachines ?? 3),
    numOperators: String(centre?.numOperators ?? 4),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name,
      location: form.location,
      district: form.district,
      state: form.state,
      dailyCapacity: Number(form.dailyCapacity),
      operatingStart: form.operatingStart,
      operatingEnd: form.operatingEnd,
      numMachines: Number(form.numMachines),
      numOperators: Number(form.numOperators),
    };
    try {
      if (centre) await api.put(`/admin/centres/${centre.id}`, payload);
      else await api.post("/admin/centres", payload);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-field">
          {centre ? t("admin.editCentre") : t("admin.addCentre")}
        </h2>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label={t("admin.name")} value={form.name} onChange={(v) => set("name", v)} wide />
          <Field label={t("admin.location")} value={form.location} onChange={(v) => set("location", v)} wide />
          <Field label={t("register.district")} value={form.district} onChange={(v) => set("district", v)} />
          <Field label={t("register.state")} value={form.state} onChange={(v) => set("state", v)} />
          <Field label={t("admin.dailyCapacity")} value={form.dailyCapacity} onChange={(v) => set("dailyCapacity", v)} type="number" />
          <div />
          <Field label={t("admin.opStart")} value={form.operatingStart} onChange={(v) => set("operatingStart", v)} type="time" />
          <Field label={t("admin.opEnd")} value={form.operatingEnd} onChange={(v) => set("operatingEnd", v)} type="time" />
          <Field label={t("admin.machines")} value={form.numMachines} onChange={(v) => set("numMachines", v)} type="number" />
          <Field label={t("admin.operators")} value={form.numOperators} onChange={(v) => set("numOperators", v)} type="number" />
        </div>

        <p className="mt-3 text-xs text-soil-light">{t("admin.capacityNote")}</p>

        <div className="mt-5 flex gap-3">
          <button className="btn-primary flex-1 !py-2.5 text-sm" onClick={save} disabled={saving}>
            {t("admin.save")}
          </button>
          <button className="btn-secondary flex-1 !py-2.5 text-sm" onClick={onClose}>
            {t("admin.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <label className="field-label">{label}</label>
      <input type={type} className="input-field" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
