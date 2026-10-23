// Turns "09:00" + 30 minutes into "09:30", etc.
// Kept as a tiny standalone helper so the slot-generation logic
// reads clearly without manual string math scattered everywhere.

export function addMinutes(time: string, minutesToAdd: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMinutes = h * 60 + m + minutesToAdd;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
