// Safety limits for weight entry. These are application limits, not
// government figures. A crop's own maximum (Crop.maxBookingKg) is stricter
// and is edited by an admin or manager on the dashboard.

// Absolute ceiling on one estimated weight (kg), a sanity check against typos.
export const ABSOLUTE_MAX_WEIGHT_KG = 1_000_000;

// How many days after the chosen date we look when nothing fits that day.
export const ALTERNATIVE_DATE_LOOKAHEAD_DAYS = 7;
export const ALTERNATIVE_DATE_RESULTS = 3;
