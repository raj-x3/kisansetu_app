// A small "too many attempts" guard, kept in the server's memory.
// It counts calls per logged-in user (or IP) in a sliding window. Fine for one
// server; with several servers each keeps its own count, so the real
// protection against duplicates is still the database (one emergency request
// per booking).

import { Request, Response, NextFunction } from "express";

const hits = new Map<string, number[]>();

export function rateLimit(name: string, max: () => number, windowMs = 60 * 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.user?.userId ?? req.ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max()) {
      res.set("Retry-After", String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({ error: "Too many attempts. Please wait a while and try again.", code: "RATE_LIMITED" });
    }
    recent.push(now);
    hits.set(key, recent);
    // Keep memory small: forget keys that have been quiet for a whole window.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    next();
  };
}
