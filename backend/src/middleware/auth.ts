// Two middleware functions that protect API routes:
//
// 1. authenticate — checks that a valid login token was sent.
//    If not, the request is rejected before it reaches your
//    controller code at all.
//
// 2. authorize(...roles) — checks that the logged-in user's
//    role is allowed to use this particular route. E.g. only
//    an ADMIN should be able to add a new procurement centre.

import { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload, AppRole } from "../utils/jwt";

// Extend Express's Request type so TypeScript knows req.user can exist.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization; // expected format: "Bearer <token>"

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not logged in. Please log in again." });
  }

  const token = header.split(" ")[1];

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
}

export function authorize(...allowedRoles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not logged in." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}
