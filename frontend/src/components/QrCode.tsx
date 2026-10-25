// Draws a QR code as a crisp SVG. The code holds only the Case ID text
// (no name, mobile number or other personal details).

import { useMemo } from "react";
import { makeQr } from "../utils/qr";

export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const grid = useMemo(() => {
    try {
      return makeQr(value);
    } catch {
      return null;
    }
  }, [value]);
  if (!grid) return null;

  const quiet = 4; // the blank border scanners need
  const n = grid.length;
  let path = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (grid[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;

  return (
    <svg
      viewBox={`0 0 ${n + quiet * 2} ${n + quiet * 2}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={value}
    >
      <rect width={n + quiet * 2} height={n + quiet * 2} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
