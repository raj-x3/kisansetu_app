import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { LanguageSelector } from "./LanguageSelector";
import { NotificationBell } from "./NotificationBell";

export function Navbar() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className="sticky top-0 z-10 border-b border-soil-light/15 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className="font-display text-lg font-bold text-field">
          Kisan Procurement Setu
        </Link>

        <div className="flex items-center gap-3">
          <LanguageSelector />

          {user ? (
            <div className="flex items-center gap-4">
              {user.role === "FARMER" && <NotificationBell />}
              <span className="hidden text-sm text-soil-light sm:inline">
                {user.fullName || user.name}
                {user.farmerCode ? ` · ${user.farmerCode}` : ""}
              </span>
              <button onClick={handleLogout} className="text-sm font-semibold text-field hover:underline">
                {t("nav.logout")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link to="/login" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-soil-light hover:bg-field/5 md:inline-block">
                {t("nav.staffLogin")}
              </Link>
              <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-field hover:bg-field/5 sm:px-4">
                {t("nav.login")}
              </Link>
              <Link to="/register" className="btn-primary !px-4 !py-2.5 text-sm sm:!px-5">
                {t("nav.register")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
