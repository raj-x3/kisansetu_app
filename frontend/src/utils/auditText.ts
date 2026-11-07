// Turns the language-neutral facts stored with an audit entry into one
// short line of text in the viewer's language.

const STAGE_KEY: Record<string, string> = {
  REGISTERED: "stage.registered",
  SLOT_BOOKED: "stage.slotBooked",
  ARRIVED: "stage.arrived",
  VERIFIED: "stage.verified",
  QUALITY_CHECKED: "stage.qualityCheck",
  WEIGHED: "stage.weighed",
  COMPLETED: "stage.completed",
};

const PAYMENT_KEY: Record<string, string> = {
  PENDING: "payment.pending",
  INITIATED: "payment.initiated",
  PROCESSING: "payment.processing",
  CREDITED: "payment.credited",
  FAILED: "payment.failed",
};

export function describeDetails(
  d: Record<string, string | number | boolean>,
  t: (key: string) => string
): string {
  const parts: string[] = [];
  if (d.token !== undefined) parts.push(`#${d.token}`);
  if (typeof d.result === "string") parts.push(t(d.result === "ACCEPTED" ? "quality.accepted" : "quality.rejected"));
  if (d.kg !== undefined) parts.push(`${d.kg} kg`);
  if (d.amount !== undefined) parts.push(`₹${d.amount}`);
  if (typeof d.cropName === "string") parts.push(d.cropName);
  if (typeof d.slotTime === "string") parts.push(d.slotTime);
  if (typeof d.docType === "string") parts.push(t(`doc.type.${d.docType}`));
  if (typeof d.docStatus === "string") parts.push(t(`doc.status.${d.docStatus}`));
  if (typeof d.fromStage === "string" && STAGE_KEY[d.fromStage]) parts.push(t(STAGE_KEY[d.fromStage]));
  if (typeof d.toStage === "string" && STAGE_KEY[d.toStage]) parts.push("→ " + t(STAGE_KEY[d.toStage]));
  if (typeof d.toStatus === "string" && PAYMENT_KEY[d.toStatus]) parts.push(t(PAYMENT_KEY[d.toStatus]));
  return parts.join(" · ");
}
