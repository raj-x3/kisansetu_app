// Next token number for a centre on a given day.
//
// Uses the highest token already issued (any booking status, including
// cancelled and no-show) plus one, instead of counting rows. Counting
// breaks as soon as a booking is cancelled or moved away: two farmers
// could then get the same token. A token number is never reused.

import { Prisma } from "@prisma/client";

export async function nextTokenNumber(tx: Prisma.TransactionClient, centreId: string, date: Date): Promise<number> {
  const result = await tx.booking.aggregate({
    _max: { tokenNumber: true },
    where: { slot: { centreId, date } },
  });
  return (result._max.tokenNumber ?? 0) + 1;
}
