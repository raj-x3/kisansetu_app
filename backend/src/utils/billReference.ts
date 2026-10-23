// Rather than adding a new database column just to store a bill
// number, we derive it from the procurement record's own ID and
// creation year — deterministic, so it always displays identically
// wherever it's shown, without needing a migration.

export function formatBillReference(procurementId: string, createdAt: Date): string {
  const year = createdAt.getFullYear();
  const shortId = procurementId.replace(/-/g, "").slice(-6).toUpperCase();
  return `BILL-${year}-${shortId}`;
}
