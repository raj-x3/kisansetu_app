// Crop-wise slot capacity for staff.
//
// Everyone on the centre's staff can LOOK (capacity, utilization, bookings,
// filters). Only admin and manager get the edit controls (canConfigure).
// Every number comes from the backend, and the panel reloads by itself when
// a booking is made, cancelled or changed.

import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";
import { StatusBadge, UsageBar } from "./SlotCapacityCard";
import { kg } from "../utils/kg";
import type { CapacityStatus } from "../types";

interface Row {
  slotId: string;
  cropId: string;
  cropName: string;
  startTime: string;
  endTime: string;
  maxWeightKg: number;
  bookedWeightKg: number;
  remainingKg: number;
  utilizationPct: number;
  confirmedFarmers: number;
  status: CapacityStatus;
}

interface Overview {
  centreId: string;
  date: string;
  rows: Row[];
  byCrop: {
    cropId: string;
    cropName: string;
    maxWeightKg: number;
    bookedWeightKg: number;
    remainingKg: number;
    utilizationPct: number;
    confirmedFarmers: number;
  }[];
  totals: { expectedWeightKg: number; confirmedFarmers: number };
}

interface BookingRow {
  id: string;
  caseId: string;
  tokenNumber: number;
  farmerName: string;
  crop: string;
  quantityKg: number;
  slotId: string;
  startTime: string;
  endTime: string;
  status: "BOOKED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
}

interface CropSetting {
  id: string;
  name: string;
  isActive: boolean;
  defaultSlotCapacityKg: number;
  maxBookingKg: number;
}

const BSTATUS = {
  BOOKED: "cap.bstatus.BOOKED",
  COMPLETED: "cap.bstatus.COMPLETED",
  CANCELLED: "cap.bstatus.CANCELLED",
  NO_SHOW: "cap.bstatus.NO_SHOW",
} as const;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function CapacityPanel({
  canConfigure,
  centres,
}: {
  canConfigure: boolean;
  // Admin only: the list to choose a centre from. Staff are tied to their own centre.
  centres?: { id: string; name: string }[];
}) {
  const { t } = useLanguage();
  const [centreId, setCentreId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [cropFilter, setCropFilter] = useState("");
  const [slotFilter, setSlotFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [crops, setCrops] = useState<CropSetting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saveDefault, setSaveDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDefault, setNewDefault] = useState("5000");
  const [newMax, setNewMax] = useState("10000");

  const needsCentre = Boolean(centres);
  useEffect(() => {
    if (needsCentre && !centreId && centres && centres.length > 0) setCentreId(centres[0].id);
  }, [needsCentre, centres, centreId]);

  const load = useCallback(async () => {
    if (needsCentre && !centreId) {
      setLoading(false);
      return;
    }
    const base = { date, ...(needsCentre ? { centreId } : {}) };
    try {
      const [ov, bk] = await Promise.all([
        api.get("/capacity/overview", { params: { ...base, ...(cropFilter ? { cropId: cropFilter } : {}) } }),
        api.get("/capacity/bookings", {
          params: {
            ...base,
            ...(cropFilter ? { cropId: cropFilter } : {}),
            ...(slotFilter ? { slotId: slotFilter } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
          },
        }),
      ]);
      setOverview(ov.data);
      setBookings(bk.data);
      setError(null);
      if (ov.data.centreId) socket.emit("join-centre", ov.data.centreId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [needsCentre, centreId, date, cropFilter, slotFilter, statusFilter]);

  const loadCrops = useCallback(() => {
    api
      .get("/crops/all")
      .then((res) => setCrops(res.data))
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadCrops();
  }, [loadCrops]);

  // Reload whenever anyone books, cancels, moves or changes capacity.
  useEffect(() => {
    socket.on("capacity-updated", load);
    socket.on("stage-updated", load);
    return () => {
      socket.off("capacity-updated", load);
      socket.off("stage-updated", load);
    };
  }, [load]);

  const slotOptions = Array.from(
    new Map((overview?.rows ?? []).map((r) => [r.slotId, `${r.startTime}–${r.endTime}`])).entries()
  );
  const rows = (overview?.rows ?? []).filter((r) => !slotFilter || r.slotId === slotFilter);

  async function saveCapacity(row: Row) {
    const value = Number(editValue);
    if (!Number.isInteger(value) || value < 0) {
      setError(t("booking.qtyError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put("/capacity/slot", {
        slotId: row.slotId,
        cropId: row.cropId,
        maxWeightKg: value,
        saveAsDefault: saveDefault,
        ...(needsCentre ? { centreId } : {}),
      });
      setEditKey(null);
      setMessage(t("cap.panel.saved"));
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function addCrop(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/crops", {
        name: newName.trim(),
        defaultSlotCapacityKg: Number(newDefault),
        maxBookingKg: Number(newMax),
      });
      setNewName("");
      setMessage(t("cap.crops.added"));
      loadCrops();
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function toggleCrop(c: CropSetting) {
    setError(null);
    try {
      await api.patch(`/crops/${c.id}`, { isActive: !c.isActive });
      loadCrops();
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <section className="mt-12">
      <h2 className="font-display text-xl font-bold text-field">{t("cap.panel.title")}</h2>
      <p className="mt-1 text-sm text-soil-light">{t("cap.panel.subtitle")}</p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="mt-3 rounded-lg bg-field/10 px-3 py-2 text-sm font-semibold text-field" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {needsCentre && (
          <div>
            <label className="field-label" htmlFor="capCentre">{t("booking.centre")}</label>
            <select id="capCentre" className="input-field" value={centreId} onChange={(e) => { setCentreId(e.target.value); setSlotFilter(""); }}>
              {centres!.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="capDate">{t("cap.panel.date")}</label>
          <input id="capDate" type="date" className="input-field" value={date} onChange={(e) => { setDate(e.target.value || todayStr()); setSlotFilter(""); }} />
        </div>
        <div>
          <label className="field-label" htmlFor="capCrop">{t("cap.col.crop")}</label>
          <select id="capCrop" className="input-field" value={cropFilter} onChange={(e) => setCropFilter(e.target.value)}>
            <option value="">{t("cap.panel.allCrops")}</option>
            {crops.filter((c) => c.isActive).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="capSlot">{t("cap.col.slot")}</label>
          <select id="capSlot" className="input-field" value={slotFilter} onChange={(e) => setSlotFilter(e.target.value)}>
            <option value="">{t("cap.panel.allSlots")}</option>
            {slotOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-soil-light">{t("slots.loading")}</p>}

      {overview && (
        <>
          {/* Day totals and per-crop utilization */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card !p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-soil-light">{t("cap.panel.expected")}</p>
              <p className="font-display text-2xl font-bold text-soil">{kg(overview.totals.expectedWeightKg)} kg</p>
            </div>
            <div className="card !p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-soil-light">{t("cap.panel.farmers")}</p>
              <p className="font-display text-2xl font-bold text-soil">{overview.totals.confirmedFarmers}</p>
            </div>
            {overview.byCrop.map((c) => (
              <div key={c.cropId} className="card !p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-soil-light">{c.cropName}</p>
                <p className="font-display text-lg font-bold text-soil">
                  {kg(c.bookedWeightKg)} / {kg(c.maxWeightKg)} kg
                </p>
                <div className="mt-1">
                  <UsageBar pct={c.utilizationPct} status={c.utilizationPct >= 100 ? "FULL" : c.utilizationPct >= 75 ? "LIMITED" : "AVAILABLE"} />
                </div>
                <p className="mt-1 text-xs text-soil-light">
                  {t("cap.occupied").replace("{pct}", String(c.utilizationPct))} · {c.confirmedFarmers} {t("cap.col.farmers")}
                </p>
              </div>
            ))}
          </div>

          {/* Capacity table */}
          <div className="mt-5 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-soil-light">{t("cap.panel.noRows")}</p>
            ) : (
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-wheat-light/30 text-xs uppercase tracking-wide text-soil-light">
                  <tr>
                    <th className="px-3 py-2">{t("cap.col.crop")}</th>
                    <th className="px-3 py-2">{t("cap.col.slot")}</th>
                    <th className="px-3 py-2">{t("cap.col.total")}</th>
                    <th className="px-3 py-2">{t("cap.col.booked")}</th>
                    <th className="px-3 py-2">{t("cap.col.remaining")}</th>
                    <th className="px-3 py-2">{t("cap.col.utilization")}</th>
                    <th className="px-3 py-2">{t("cap.col.farmers")}</th>
                    <th className="px-3 py-2">{t("cap.col.status")}</th>
                    {canConfigure && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const key = `${r.slotId}|${r.cropId}`;
                    const editing = editKey === key;
                    return (
                      <tr key={key} className="border-t border-soil-light/10 align-top">
                        <td className="px-3 py-2 font-semibold text-soil">{r.cropName}</td>
                        <td className="px-3 py-2">{r.startTime}–{r.endTime}</td>
                        <td className="px-3 py-2">
                          {editing ? (
                            <div className="flex min-w-[170px] flex-col gap-2">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="input-field !py-1"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                aria-label={t("cap.col.total")}
                              />
                              <label className="flex items-start gap-2 text-xs text-soil-light">
                                <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} className="mt-0.5" />
                                {t("cap.panel.saveDefault")}
                              </label>
                              <div className="flex gap-2">
                                <button className="btn-primary !px-3 !py-1 text-xs" disabled={saving} onClick={() => saveCapacity(r)}>
                                  {t("cap.panel.save")}
                                </button>
                                <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => setEditKey(null)}>
                                  {t("cap.panel.cancel")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            kg(r.maxWeightKg)
                          )}
                        </td>
                        <td className="px-3 py-2">{kg(r.bookedWeightKg)}</td>
                        <td className="px-3 py-2 font-semibold">{kg(r.remainingKg)}</td>
                        <td className="px-3 py-2">
                          <div className="w-24">
                            <UsageBar pct={r.utilizationPct} status={r.status} />
                            <span className="text-xs text-soil-light">{r.utilizationPct}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{r.confirmedFarmers}</td>
                        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                        {canConfigure && (
                          <td className="px-3 py-2">
                            {!editing && (
                              <button
                                className="text-xs font-semibold text-field underline"
                                onClick={() => { setEditKey(key); setEditValue(String(r.maxWeightKg)); }}
                              >
                                {t("cap.panel.edit")}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Bookings */}
          <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
            <h3 className="font-display text-lg font-semibold text-soil">{t("cap.panel.bookings")}</h3>
            <div className="w-full sm:w-56">
              <label className="field-label" htmlFor="capStatus">{t("cap.col.status")}</label>
              <select id="capStatus" className="input-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t("cap.panel.allStatuses")}</option>
                {(Object.keys(BSTATUS) as (keyof typeof BSTATUS)[]).map((s) => (
                  <option key={s} value={s}>{t(BSTATUS[s])}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-soil-light/20 bg-white">
            {bookings.length === 0 ? (
              <p className="p-4 text-sm text-soil-light">{t("cap.panel.noBookings")}</p>
            ) : (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-wheat-light/30 text-xs uppercase tracking-wide text-soil-light">
                  <tr>
                    <th className="px-3 py-2">{t("cap.col.token")}</th>
                    <th className="px-3 py-2">{t("case.id")}</th>
                    <th className="px-3 py-2">{t("cap.col.farmer")}</th>
                    <th className="px-3 py-2">{t("cap.col.crop")}</th>
                    <th className="px-3 py-2">{t("cap.col.weight")}</th>
                    <th className="px-3 py-2">{t("cap.col.slot")}</th>
                    <th className="px-3 py-2">{t("cap.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-t border-soil-light/10">
                      <td className="px-3 py-2 font-semibold">{b.tokenNumber}</td>
                      <td className="px-3 py-2">{b.caseId}</td>
                      <td className="px-3 py-2">{b.farmerName}</td>
                      <td className="px-3 py-2">{b.crop}</td>
                      <td className="px-3 py-2">{kg(b.quantityKg)}</td>
                      <td className="px-3 py-2">{b.startTime}–{b.endTime}</td>
                      <td className="px-3 py-2">{t(BSTATUS[b.status])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Crop management: admin and manager only */}
      {canConfigure && (
        <div className="card mt-8">
          <h3 className="font-display text-lg font-semibold text-soil">{t("cap.crops.title")}</h3>
          <p className="mt-1 text-sm text-soil-light">{t("cap.crops.hint")}</p>

          <ul className="mt-4 divide-y divide-soil-light/10 text-sm">
            {crops.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-semibold text-soil">{c.name}</span>
                  <span className="ml-2 text-xs text-soil-light">
                    {kg(c.defaultSlotCapacityKg)} kg · max {kg(c.maxBookingKg)} kg
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold ${c.isActive ? "text-field" : "text-soil-light"}`}>
                    {c.isActive ? t("cap.crops.active") : t("cap.crops.hidden")}
                  </span>
                  <button className="text-xs font-semibold text-field underline" onClick={() => toggleCrop(c)}>
                    {c.isActive ? t("cap.crops.hide") : t("cap.crops.show")}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <form onSubmit={addCrop} className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="newCropName">{t("cap.crops.name")}</label>
              <input id="newCropName" className="input-field" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} maxLength={40} />
            </div>
            <div>
              <label className="field-label" htmlFor="newCropCap">{t("cap.crops.defaultCap")}</label>
              <input id="newCropCap" type="number" min={1} step={1} className="input-field" value={newDefault} onChange={(e) => setNewDefault(e.target.value)} required />
            </div>
            <div>
              <label className="field-label" htmlFor="newCropMax">{t("cap.crops.maxBooking")}</label>
              <input id="newCropMax" type="number" min={1} step={1} className="input-field" value={newMax} onChange={(e) => setNewMax(e.target.value)} required />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" className="btn-primary w-full sm:w-auto">{t("cap.crops.add")}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
