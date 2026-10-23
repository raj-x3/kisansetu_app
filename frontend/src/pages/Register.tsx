import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { getErrorMessage } from "../services/api";

export function Register() {
  const { register } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: "",
    mobile: "",
    email: "",
    password: "",
    address: "",
    district: "",
    state: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({
        ...form,
        email: form.email.trim() === "" ? undefined : form.email,
      });
      navigate("/farmer/dashboard");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-field">{t("register.title")}</h1>
      <p className="mt-2 text-soil-light">{t("register.subtitle")}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="fullName">{t("register.fullName")}</label>
          <input
            id="fullName"
            className="input-field"
            value={form.fullName}
            onChange={(e) => update("fullName", e.target.value)}
            placeholder="e.g. Ramesh Kumar"
            required
          />
        </div>

        <div>
          <label className="field-label" htmlFor="mobile">{t("register.mobile")}</label>
          <input
            id="mobile"
            className="input-field"
            inputMode="numeric"
            value={form.mobile}
            onChange={(e) => update("mobile", e.target.value)}
            placeholder="10-digit mobile number"
            required
          />
        </div>

        <div>
          <label className="field-label" htmlFor="email">Email (optional)</label>
          <input
            id="email"
            type="email"
            className="input-field"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="password">{t("register.password")}</label>
          <input
            id="password"
            type="password"
            className="input-field"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder={t("register.passwordHint")}
            required
            minLength={6}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="address">{t("register.address")}</label>
          <input
            id="address"
            className="input-field"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            placeholder={t("register.addressHint")}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="district">{t("register.district")}</label>
            <input
              id="district"
              className="input-field"
              value={form.district}
              onChange={(e) => update("district", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="state">{t("register.state")}</label>
            <input
              id="state"
              className="input-field"
              value={form.state}
              onChange={(e) => update("state", e.target.value)}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? "…" : t("register.submit")}
        </button>

        <p className="text-center text-sm text-soil-light">
          <Link to="/login" className="font-semibold text-field hover:underline">
            {t("register.haveAccount")}
          </Link>
        </p>
      </form>
    </div>
  );
}
