// This talks to Google's Gemini API (https://ai.google.dev). It needs
// YOUR OWN free API key from Google AI Studio, set as GEMINI_API_KEY in
// backend/.env — we can't ship a working key for you, since it's tied
// to a personal Google account and usage quota.
//
// Node 18+ has a built-in `fetch`, so no extra HTTP library is needed.

import { Request, Response } from "express";
import { z } from "zod";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
};

const messageSchema = z.object({
  message: z.string().min(1, "Message can't be empty."),
  language: z.string().min(2).default("en"),
});

export async function sendMessage(req: Request, res: Response) {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { message, language } = parsed.data;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error:
        "The AI assistant isn't configured yet. Add GEMINI_API_KEY to backend/.env to enable it.",
    });
  }

  const languageName = LANGUAGE_NAMES[language] || "English";
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const systemInstruction =
    `You are a friendly, concise assistant for "Kisan Procurement Setu", a digital ` +
    `agricultural procurement platform. You help farmers with questions about ` +
    `registering an account, booking a procurement slot, understanding their queue ` +
    `token, and what each stage of the procurement process means. Keep answers short ` +
    `and simple, suitable for someone who may not be familiar with technology. ` +
    `Respond ONLY in ${languageName}, regardless of what language the question is asked in.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: message }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Gemini API error:", response.status, errBody);
      return res.status(502).json({ error: "The AI assistant couldn't respond right now. Please try again." });
    }

    const data = await response.json();
    const reply: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Sorry, I couldn't come up with a response. Please try rephrasing your question.";

    return res.json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Couldn't reach the AI assistant. Please try again." });
  }
}
