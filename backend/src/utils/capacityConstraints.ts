// Database-level safety net for slot capacity.
//
// The booking code already refuses to overbook. This adds a rule inside
// PostgreSQL itself: a capacity row can never hold negative numbers or more
// booked weight than its maximum, even if a future bug or a manual edit
// tried. Prisma's schema file cannot describe CHECK rules, so we add it
// here. Safe to run on every start: it only adds the rule once.

import { prisma } from "./prismaClient";

export async function ensureCapacityConstraints(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slot_capacities_weight_check') THEN
          ALTER TABLE slot_capacities ADD CONSTRAINT slot_capacities_weight_check
            CHECK (max_weight_kg >= 0 AND booked_weight_kg >= 0 AND booked_count >= 0
                   AND booked_weight_kg <= max_weight_kg);
        END IF;
      END $$;
    `);
  } catch (err) {
    // The table may not exist yet if the database was not updated. Say so
    // clearly in the server log, but never stop the server for it.
    console.error("Could not add the slot-capacity safety rule (is the database up to date?):", err);
  }
}
