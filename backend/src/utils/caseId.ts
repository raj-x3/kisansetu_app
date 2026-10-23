// Generates the formal Case ID shown to farmers and officers,
// e.g. CASE-2026-000047.
//
// It takes the highest existing number for that year and adds 1
// (instead of counting rows) so it stays unique even after the
// simulation reset deletes some bookings. The column is @unique in
// the database, so if two bookings ever raced for the same number
// the second one would fail cleanly rather than create a duplicate.

import { Prisma } from "@prisma/client";

export async function nextCaseId(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `CASE-${year}-`;
  const last = await tx.booking.findFirst({
    where: { caseId: { startsWith: prefix } },
    orderBy: { caseId: "desc" },
    select: { caseId: true },
  });
  const lastNumber = last ? parseInt(last.caseId.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastNumber + 1).padStart(6, "0")}`;
}
