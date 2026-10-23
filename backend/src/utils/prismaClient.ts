// A single shared connection to the database, reused across the
// whole app instead of opening a new connection every time.

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
