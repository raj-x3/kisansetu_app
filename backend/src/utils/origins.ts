// Which website addresses may call this API (CORS).
//
// FRONTEND_URL can be one address or several separated by commas, for
// example "https://my-site.onrender.com,http://localhost:5173".
// A trailing "/" is ignored, because browsers send the address without
// one and a mismatch there is the most common deployment mistake.

export function allowedOrigins(): string[] {
  const raw = process.env.FRONTEND_URL || "http://localhost:5173";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}
