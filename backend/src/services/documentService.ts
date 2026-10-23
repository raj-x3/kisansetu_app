// Small helpers for the document feature: file checks and the optional
// "identity must be verified first" rule.

import { prisma } from "../utils/prismaClient";

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_DOCUMENTS_PER_BOOKING = 6;

// Decide the real file type from the first bytes of the file, NOT from
// the name or the type the browser claims — those can be faked.
export function detectMimeType(bytes: Buffer): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (bytes.length >= 4 && bytes.slice(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (bytes.length >= 8 && bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

// Strips folders and odd characters from an uploaded file name.
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "document";
}

// The setting REQUIRE_DOCUMENTS=true makes "Mark verified" refuse until
// the farmer's latest identity proof has been VERIFIED by the document
// officer. It is off by default so the demo and Simulation Mode keep
// working without uploading files.
export async function documentsRuleError(bookingId: string): Promise<string | null> {
  if (process.env.REQUIRE_DOCUMENTS !== "true") return null;
  const latest = await prisma.document.findFirst({
    where: { bookingId, type: "IDENTITY_PROOF" },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!latest) return "This farmer has not uploaded an identity proof yet.";
  if (latest.status !== "VERIFIED") return "The identity proof must be reviewed and marked verified first.";
  return null;
}
