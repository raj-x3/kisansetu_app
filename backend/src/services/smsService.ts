// Sends real SMS messages via Fast2SMS (https://www.fast2sms.com), an
// SMS gateway built specifically for Indian mobile numbers.
//
// Requires YOUR OWN API key in backend/.env as FAST2SMS_API_KEY — we
// can't ship one, since it's tied to a personal account and prepaid
// SMS credits.
//
// One real-world note: sending PROMOTIONAL SMS to Indian numbers
// legally requires DLT (Distributed Ledger Technology) template
// registration with your telecom operator — a genuine regulatory
// process, not something code alone can bypass. This uses Fast2SMS's
// "Quick SMS" route (route: "q"), meant for transactional/OTP-style
// messages like booking confirmations, which does not require DLT
// registration for testing and low-volume use. For production-scale
// sending, you would register a DLT template and switch routes.
//
// If no API key is configured, this quietly logs a warning and does
// NOT throw — sending an SMS should never be allowed to break a
// booking or registration that otherwise succeeded.

const FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2";

export async function sendSms(mobile: string, message: string): Promise<void> {
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    console.warn(`[SMS not sent — FAST2SMS_API_KEY not configured] Would have sent to ${mobile}: ${message}`);
    return;
  }

  try {
    const response = await fetch(FAST2SMS_URL, {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "q", // Quick SMS — transactional, no DLT template required
        message,
        language: "english",
        flash: 0,
        numbers: mobile,
      }),
    });

    const data = await response.json();
    if (!response.ok || data?.return === false) {
      console.error("Fast2SMS did not accept the message:", data);
    }
  } catch (err) {
    // Never let an SMS failure break the calling feature (registration,
    // booking, etc.) — just log it so it's visible during development.
    console.error("Failed to send SMS:", err);
  }
}
