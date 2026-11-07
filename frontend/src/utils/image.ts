// Prepares an evidence file before it is uploaded.
//
// Photos from a phone are often 3-8 MB. We shrink them in the browser
// (longest side 1600 px, JPEG) so they upload fast on a weak network.
// Redrawing a photo on a canvas also removes its hidden details (camera,
// GPS position), which is better for the farmer's privacy. The server never
// trusts a photo's hidden details as proof of where it was taken.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class EvidenceFileError extends Error {
  constructor(public code: "TYPE" | "BIG" | "READ") {
    super(code);
  }
}

export interface PreparedFile {
  fileName: string;
  dataBase64: string;
  bytes: number;
  isImage: boolean;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new EvidenceFileError("READ"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new EvidenceFileError("READ"));
    };
    img.src = url;
  });
}

export async function prepareEvidence(file: File): Promise<PreparedFile> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
  if (!isPdf && !isImage) throw new EvidenceFileError("TYPE");

  if (isPdf) {
    if (file.size > MAX_FILE_BYTES) throw new EvidenceFileError("BIG");
    return { fileName: file.name, dataBase64: await blobToBase64(file), bytes: file.size, isImage: false };
  }

  const img = await loadImage(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new EvidenceFileError("READ");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) throw new EvidenceFileError("READ");
  if (blob.size > MAX_FILE_BYTES) throw new EvidenceFileError("BIG");
  return {
    fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
    dataBase64: await blobToBase64(blob),
    bytes: blob.size,
    isImage: true,
  };
}

// Opens a protected file (it needs the login token) in a new tab.
export function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
