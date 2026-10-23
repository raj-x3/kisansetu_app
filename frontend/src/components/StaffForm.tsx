// Admin-only: create an account for an officer or manager.
// The server checks everything again (and only allows ADMIN).

import { FormEvent, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";

const ROLES = [
  "MANAGER",
  "GATE_OFFICER",
  "DOCUMENT_OFFICER",
  "QUALITY_OFFICER",
  "WEIGHT_OFFICER",
  "PROCUREMENT_OFFICER",
  "PAYMENT_OFFICER",
] as const;

export function StaffForm({ centres }: { centres: { id: string; name: string }[] }) {
  const { t } = useLanguage();
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("GATE_OFFICER");
  const [centreId, setCentreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.post("/admin/users", { fullName, mobile, password, role, centreId: centreId || centres[0]?.id });
      setMessage(t("staff.created").replace("{name}", res.data.fullName).replace("{mobile}", res.data.mobile));
      setFullName("");
      setMobile("");
      setPassword("");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-12 rounded-xl border border-soil-light/20 bg-white p-5">
      <h2 className="font-display text-xl font-bold text-field">{t("staff.title")}</h2>
      <p className="mt-1 text-sm text-soil-light">{t("staff.subtitle")}</p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="mt-3 rounded-lg bg-field/10 px-3 py-2 text-sm font-semibold text-field">{message}</div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">{t("staff.fullName")}</label>
          <input className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">{t("staff.mobile")}</label>
          <input
            className="input-field"
            value={mobile}
            inputMode="numeric"
            maxLength={10}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
        <div>
          <label className="field-label">{t("staff.role")}</label>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`staff.role.${r}` as never)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">{t("staff.centre")}</label>
          <select className="input-field" value={centreId || centres[0]?.id || ""} onChange={(e) => setCentreId(e.target.value)}>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">{t("staff.password")}</label>
          <input
            type="password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <p className="mt-1 text-xs text-soil-light">{t("staff.passwordHint")}</p>
        </div>
      </div>

      <button type="submit" className="btn-primary mt-5" disabled={busy || centres.length === 0}>
        {t("staff.create")}
      </button>
    </form>
  );
}
