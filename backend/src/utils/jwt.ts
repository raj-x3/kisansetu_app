// Creates and checks login tokens (JWTs).
//
// After a farmer/operator/admin logs in successfully, we hand
// them a signed token. Their browser sends that token back on
// every future request (in the Authorization header) instead of
// re-sending a password. We can verify the token was really
// issued by us (it's signed with JWT_SECRET) and hasn't expired.

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!JWT_SECRET) {
  // Fail loudly at startup rather than silently issuing insecure tokens.
  throw new Error("JWT_SECRET is not set. Copy .env.example to .env and set it.");
}

export type AppRole =
  | "FARMER"
  | "OPERATOR"
  | "ADMIN"
  | "MANAGER"
  | "GATE_OFFICER"
  | "DOCUMENT_OFFICER"
  | "QUALITY_OFFICER"
  | "WEIGHT_OFFICER"
  | "PROCUREMENT_OFFICER"
  | "PAYMENT_OFFICER";

export interface TokenPayload {
  userId: string;
  role: AppRole;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
