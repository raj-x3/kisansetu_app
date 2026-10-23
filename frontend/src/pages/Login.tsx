import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { getErrorMessage } from "../services/api";

export function Login() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [mobileOrEmail, setMobileOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(mobileOrEmail, password);
      if (user.role === "FARMER") navigate("/farmer/dashboard");
      else if (user.role === "OPERATOR") navigate("/operator/queue");
      else if (user.role === "ADMIN") navigate("/admin/dashboard");
      else if (user.role === "MANAGER") navigate("/manager/dashboard");
      else navigate("/officer/dashboard");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-field">{t("login.title")}</h1>
      <p className="mt-2 text-soil-light">{t("login.subtitle")}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="mobileOrEmail">{t("login.mobileOrEmail")}</label>
          <input
            id="mobileOrEmail"
            className="input-field"
            value={mobileOrEmail}
            onChange={(e) => setMobileOrEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="field-label" htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            type="password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? "…" : t("login.submit")}
        </button>

        <p className="text-center text-sm text-soil-light">
          <Link to="/register" className="font-semibold text-field hover:underline">
            {t("login.newHere")}
          </Link>
        </p>

        <div className="rounded-xl border border-soil-light/20 bg-white p-4 text-sm text-soil-light">
          <p className="font-semibold text-soil">{t("login.staffTitle")}</p>
          <p className="mt-1">{t("login.staffNote")}</p>
        </div>
      </form>
    </div>
  );
}
