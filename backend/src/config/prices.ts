// DEMO PRICING ONLY — these are placeholder values for the prototype,
// NOT real government-notified procurement prices (MSP). An actual
// deployment would replace this with prices configured by an admin
// through a real settings screen (planned for the Admin dashboard
// module) — this file exists so that piece can be built later without
// having to touch the completion logic itself.

export const DEMO_PRICE_PER_KG: Record<string, number> = {
  Wheat: 25,
  Paddy: 21,
  Maize: 18,
  Mustard: 55,
  Sugarcane: 3.5,
};

export const DEFAULT_PRICE_PER_KG = 20; // used if a crop isn't in the list above

export function getPricePerKg(crop: string): number {
  return DEMO_PRICE_PER_KG[crop] ?? DEFAULT_PRICE_PER_KG;
}
