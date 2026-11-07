// Background work that must not depend on anyone having a browser open:
//   - close slot offers whose time is up, and offer the room to the next farmer
//   - tell waiting farmers when their wait time rose a lot
//
// It runs inside the same Node process, on a timer. Everything it does is
// driven by the database (offer.expiresAt), so if the server was asleep or
// restarted, the next tick simply catches up. Every step is safe to repeat.
// (If you later run several server copies, each runs the job; the guarded
// updates in waitlistService make that harmless.)

import { queueConfig } from "../config/queue";
import { expireDueOffers } from "./waitlistService";
import { sweepQueueNotifications } from "./queueService";

let timer: NodeJS.Timeout | null = null;
let running = false;
let tick = 0;

async function runOnce() {
  if (running) return; // never overlap with a slow previous run
  running = true;
  try {
    const expired = await expireDueOffers();
    if (expired > 0) console.log(`[jobs] expired ${expired} slot offer(s)`);
    // Queue notifications are checked about once a minute.
    if (tick++ % 2 === 0) {
      const sent = await sweepQueueNotifications();
      if (sent > 0) console.log(`[jobs] sent ${sent} wait-time update(s)`);
    }
  } catch (err) {
    console.error("[jobs] tick failed:", err);
  } finally {
    running = false;
  }
}

export function startBackgroundJobs(): void {
  if (timer) return;
  const seconds = queueConfig().jobTickSeconds;
  timer = setInterval(() => void runOnce(), seconds * 1000);
  timer.unref?.();
  void runOnce(); // catch up straight away after a restart
  console.log(`[jobs] background jobs running every ${seconds}s`);
}

export const _runJobsOnceForTests = runOnce;
