import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { socket } from "../services/socket";
import { useLanguage } from "../context/LanguageContext";

interface Notif {
  id: string;
  type: string;
  params: Record<string, string | number> | null;
  message: string; // English fallback only
  isRead: boolean;
  createdAt: string;
}

// Fills "{token}" style placeholders in a translated sentence.
function fill(template: string, params: Notif["params"]): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ""));
}

export function NotificationBell() {
  const { t } = useLanguage();
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api
      .get("/notifications")
      .then((res) => {
        setItems(res.data.items);
        setUnread(res.data.unreadCount);
      })
      .catch(() => {
        /* the bell is a convenience — if it can't load, stay quiet */
      });
  }, []);

  useEffect(() => {
    load();

    // Prove who we are to the server so it puts us in our own private
    // room. Repeat on every (re)connect, since rooms reset when the
    // connection drops.
    function joinMyRoom() {
      socket.emit("join-user", localStorage.getItem("token"));
    }
    function handleNew(n: Notif) {
      setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
      setUnread((u) => u + 1);
    }

    joinMyRoom();
    socket.on("connect", joinMyRoom);
    socket.on("notification", handleNew);
    return () => {
      socket.off("connect", joinMyRoom);
      socket.off("notification", handleNew);
    };
  }, [load]);

  // Close the panel when clicking anywhere outside it.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markAllRead() {
    try {
      await api.post("/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnread(0);
    } catch {
      /* ignore — the list will correct itself on next load */
    }
  }

  function textFor(n: Notif): string {
    const template = t(`notif.${n.type}` as any);
    // t() returns the key itself when there's no translation — fall
    // back to the stored English sentence in that case.
    if (template.startsWith("notif.")) return n.message;
    // Document notices carry raw enum values; show them in the viewer's language.
    const params = { ...n.params };
    if (typeof params.docType === "string") params.docType = t(`doc.type.${params.docType}` as any);
    if (typeof params.docStatus === "string") params.docStatus = t(`doc.status.${params.docStatus}` as any);
    return fill(template, params);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-field/5"
        aria-label={t("notif.title")}
        title={t("notif.title")}
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[90vw] rounded-xl border border-soil-light/20 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-soil-light/15 px-4 py-3">
            <p className="font-display text-sm font-semibold text-soil">{t("notif.title")}</p>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold text-field underline">
                {t("notif.markAllRead")}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-soil-light">{t("notif.empty")}</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-soil-light/10 px-4 py-3 text-sm last:border-b-0 ${
                    n.isRead ? "text-soil-light" : "bg-wheat-light/20 font-medium text-soil"
                  }`}
                >
                  <p>{textFor(n)}</p>
                  <p className="mt-1 text-[11px] text-soil-light">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
