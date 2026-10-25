// Opens the phone or laptop camera and reads a farmer's QR code.
//
// It uses the browser's built-in QR reader (BarcodeDetector). That exists
// in Chrome on Android and desktop Chrome, but NOT in iPhone Safari. When it
// is missing we say so and the officer types the Case ID instead — the
// search box works the same either way.

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";

// The part of the browser API we use (it is not in older TypeScript typings).
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

const CASE_ID = /CASE-\d{4}-\d{6}/i;

export function ScanModal({ onResult, onClose }: { onResult: (caseId: string) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unsupported" | "cameraError">("starting");

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        video.play().catch(() => undefined);
        setStatus("scanning");
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            const match = codes.map((c) => c.rawValue.match(CASE_ID)?.[0]).find(Boolean);
            if (match && !stopped) {
              stopped = true;
              onResult(match.toUpperCase());
            }
          } catch {
            /* a frame that can't be read is fine — try the next one */
          }
        }, 400);
      })
      .catch(() => setStatus("cameraError"));

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-field">{t("scan.title")}</h2>

        {status === "unsupported" && <p className="mt-3 text-sm text-soil-light">{t("scan.unsupported")}</p>}
        {status === "cameraError" && <p className="mt-3 text-sm text-red-600">{t("scan.cameraError")}</p>}
        {(status === "starting" || status === "scanning") && (
          <>
            <video ref={videoRef} playsInline muted className="mt-3 w-full rounded-xl bg-black" />
            <p className="mt-2 text-sm text-soil-light">{t("scan.hint")}</p>
          </>
        )}

        <button className="btn-secondary mt-5 w-full" onClick={onClose}>
          {t("doc.close")}
        </button>
      </div>
    </div>
  );
}
