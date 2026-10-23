import { useEffect, useRef, useState } from "react";
import { api, getErrorMessage } from "../services/api";
import { useLanguage } from "../context/LanguageContext";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

const SpeechRecognitionCtor =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function ChatBot() {
  const { t, language, speechCode } = useLanguage();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const recognitionRef = useRef<any>(null);

  // Voices load asynchronously in the browser — sometimes they're not
  // ready the instant the page loads. This was the main cause of
  // "voice doesn't work": speaking before any voice list existed meant
  // the browser fell back to a default (often English-only) voice
  // regardless of the requested language.
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    function loadVoices() {
      setVoices(window.speechSynthesis.getVoices());
    }
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await api.post("/chat/message", { message: trimmed, language });
      const reply: string = res.data.reply;
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      speak(reply);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel(); // stop any previous, still-playing reply first

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechCode;

    // Prefer an exact match (e.g. "hi-IN"), fall back to any voice for
    // the same base language (e.g. any "hi-*"), and only fall back to
    // the browser's default if truly nothing matches.
    const exactMatch = voices.find((v) => v.lang === speechCode);
    const looseMatch = voices.find((v) => v.lang.startsWith(speechCode.split("-")[0]));
    const chosenVoice = exactMatch || looseMatch;
    if (chosenVoice) utterance.voice = chosenVoice;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function startListening() {
    if (!SpeechRecognitionCtor) {
      setError(t("chat.micUnsupported"));
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = speechCode;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionResultLike) => {
      const transcript = event.results[0][0].transcript;
      sendMessage(transcript);
    };

    // Specific, actionable messages instead of one generic failure —
    // this was the other main cause of "voice doesn't work": the
    // person had no idea WHY it failed (permission blocked? no mic?
    // no internet? Chrome's speech recognition needs an active
    // connection since it uses a cloud engine).
    recognition.onerror = (event: { error: string }) => {
      setListening(false);
      switch (event.error) {
        case "not-allowed":
        case "service-not-allowed":
          setError(t("chat.micDenied"));
          break;
        case "no-speech":
          setError(t("chat.noSpeechDetected"));
          break;
        case "audio-capture":
          setError(t("chat.noMicFound"));
          break;
        case "network":
          setError(t("chat.networkRequired"));
          break;
        default:
          setError(t("chat.micUnsupported"));
      }
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  const micSupported = !!SpeechRecognitionCtor;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-field text-2xl text-paper shadow-lg transition hover:bg-field-dark"
        aria-label={t("chat.title")}
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-20 flex h-[28rem] w-[22rem] max-w-[90vw] flex-col rounded-2xl border border-soil-light/20 bg-white shadow-2xl">
          <div className="flex items-center justify-between rounded-t-2xl bg-field px-4 py-3 text-paper">
            <p className="font-display font-semibold">{t("chat.title")}</p>
            {speaking && (
              <button
                onClick={stopSpeaking}
                className="rounded-full bg-paper/20 px-2 py-1 text-xs hover:bg-paper/30"
                title={t("chat.stopSpeaking")}
              >
                ⏹ {t("chat.stopSpeaking")}
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-soil-light">{t("chat.greeting")}</p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={[
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  m.role === "user" ? "ml-auto bg-field text-paper" : "bg-soil-light/10 text-soil",
                ].join(" ")}
              >
                {m.text}
              </div>
            ))}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-soil-light/15 p-3">
            <button
              onClick={listening ? stopListening : startListening}
              disabled={!micSupported || sending}
              className={[
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition disabled:cursor-not-allowed disabled:opacity-40",
                listening ? "bg-wheat text-soil" : "bg-soil-light/10 text-soil hover:bg-soil-light/20",
              ].join(" ")}
              aria-label={listening ? t("chat.listening") : "Voice input"}
              title={!micSupported ? t("chat.micUnsupported") : listening ? t("chat.listening") : "Voice input"}
            >
              🎤
            </button>
            <input
              className="input-field !py-2 flex-1 text-sm"
              placeholder={listening ? t("chat.listening") : t("chat.placeholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
              disabled={sending || listening}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={sending || !input.trim()}
              className="btn-primary !px-4 !py-2 text-sm"
            >
              {t("chat.send")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
