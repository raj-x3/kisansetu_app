// Shows a weight with thousands separators, e.g. 2500 -> "2,500".
export function kg(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}
