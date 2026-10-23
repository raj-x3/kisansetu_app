import { Link } from "react-router-dom";
import { ProcessChain } from "../components/ProcessChain";
import { useLanguage } from "../context/LanguageContext";

// Only translation KEYS live here. The words themselves come from
// i18n/translations.ts, so every box, step and flowchart label changes
// when the language changes.
const JOURNEY_KEYS = [
  "stage.registered", "stage.slotBooked", "stage.arrived", "stage.verified",
  "stage.qualityCheck", "stage.weighed", "stage.completed", "landing.paid",
] as const;

const PROBLEMS = [
  { title: "landing.problem1Title", body: "landing.problem1Body" },
  { title: "landing.problem2Title", body: "landing.problem2Body" },
  { title: "landing.problem3Title", body: "landing.problem3Body" },
  { title: "landing.problem4Title", body: "landing.problem4Body" },
] as const;

const SOLUTIONS = ["landing.sol1", "landing.sol2", "landing.sol3", "landing.sol4", "landing.sol5", "landing.sol6"] as const;

const STEPS = [
  "landing.step1", "landing.step2", "landing.step3", "landing.step4",
  "landing.step5", "landing.step6", "landing.step7", "landing.step8",
] as const;

export function Landing() {
  const { t } = useLanguage();
  return (
    <div>
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="mb-3 inline-block rounded-full bg-wheat-light/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-soil">
              {t("hero.badge")}
            </p>
            <h1 className="font-display text-4xl font-bold leading-tight text-field sm:text-5xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-soil-light">
              {t("hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="btn-primary">
                {t("hero.registerBtn")}
              </Link>
              <Link to="/login" className="btn-secondary">
                {t("hero.loginBtn")}
              </Link>
              <Link to="/login" className="inline-flex items-center px-4 py-3.5 text-sm font-semibold text-soil-light hover:underline">
                {t("nav.staffLogin")}
              </Link>
              <a href="#how-it-works" className="inline-flex items-center px-4 py-3.5 text-sm font-semibold text-field hover:underline">
                {t("hero.howItWorks")}
              </a>
            </div>
          </div>

          <div className="card">
            <p className="field-label">{t("landing.journeyTitle")}</p>
            <ProcessChain stages={JOURNEY_KEYS.map((k) => t(k))} currentIndex={4} />
            <p className="mt-4 text-sm text-soil-light">
              {t("landing.journeyExample")}
            </p>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("landing.problemTitle")}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="card">
                <h3 className="font-display font-semibold text-soil">{t(p.title)}</h3>
                <p className="mt-2 text-sm text-soil-light">{t(p.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOLUTION */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("landing.solutionTitle")}</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {SOLUTIONS.map((s) => (
              <li key={s} className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-field text-xs font-bold text-paper">✓</span>
                <span className="text-soil">{t(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("landing.howTitle")}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step} className="card">
                <span className="font-display text-2xl font-bold text-wheat">{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-2 text-sm text-soil">{t(step)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-bold text-field sm:text-3xl">{t("landing.helpsTitle")}</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <div className="card">
              <h3 className="font-display font-semibold text-field">{t("landing.forFarmers")}</h3>
              <ul className="mt-3 space-y-2 text-sm text-soil-light">
                <li>{t("landing.farmer1")}</li>
                <li>{t("landing.farmer2")}</li>
                <li>{t("landing.farmer3")}</li>
                <li>{t("landing.farmer4")}</li>
              </ul>
            </div>
            <div className="card">
              <h3 className="font-display font-semibold text-field">{t("landing.forCentres")}</h3>
              <ul className="mt-3 space-y-2 text-sm text-soil-light">
                <li>{t("landing.centre1")}</li>
                <li>{t("landing.centre2")}</li>
                <li>{t("landing.centre3")}</li>
              </ul>
            </div>
            <div className="card">
              <h3 className="font-display font-semibold text-field">{t("landing.forAdmins")}</h3>
              <ul className="mt-3 space-y-2 text-sm text-soil-light">
                <li>{t("landing.admin1")}</li>
                <li>{t("landing.admin2")}</li>
                <li>{t("landing.admin3")}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-soil-light/15 py-8 text-center text-sm text-soil-light">
        {t("landing.footer")}
      </footer>
    </div>
  );
}
