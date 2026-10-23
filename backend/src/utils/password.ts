// Handles turning plain-text passwords into secure hashes, and
// checking a login attempt against a stored hash.
//
// We NEVER store a farmer/operator/admin's real password anywhere.
// We only store the "hash" — a one-way scrambled version that
// can be checked but never reversed back into the original password.

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainTextPassword: string,
  storedHash: string
): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, storedHash);
}
