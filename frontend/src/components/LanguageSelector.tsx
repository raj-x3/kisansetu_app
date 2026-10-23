import { LANGUAGES, LanguageCode } from "../i18n/translations";
import { useLanguage } from "../context/LanguageContext";

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as LanguageCode)}
      aria-label={t("lang.select")}
      className="rounded-lg border border-soil-light/30 bg-white px-2 py-1.5 text-sm font-medium text-soil focus:border-field focus:outline-none"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
