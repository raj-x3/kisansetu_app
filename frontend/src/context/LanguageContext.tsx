import { createContext, useContext, useState, ReactNode } from "react";
import { LanguageCode, LANGUAGES, TRANSLATIONS } from "../i18n/translations";

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  speechCode: string; // BCP-47 code for the voice input/output feature
  t: (key: keyof (typeof TRANSLATIONS)["en"]) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const STORAGE_KEY = "language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
    return saved && TRANSLATIONS[saved] ? saved : "en";
  });

  function setLanguage(lang: LanguageCode) {
    localStorage.setItem(STORAGE_KEY, lang);
    setLanguageState(lang);
  }

  function t(key: keyof (typeof TRANSLATIONS)["en"]): string {
    return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
  }

  const speechCode = LANGUAGES.find((l) => l.code === language)?.speechCode ?? "en-IN";

  return (
    <LanguageContext.Provider value={{ language, setLanguage, speechCode, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}
