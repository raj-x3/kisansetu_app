// The common shape every weather provider converts its answer into, so the
// verification engine never needs to know which provider was used.

export type PointLabel = "farmer" | "centre" | "route" | "area";

export interface GeoPoint {
  label: PointLabel;
  lat: number;
  lng: number;
}

// One hour of weather. `endMs` is the END of the hour (UTC milliseconds);
// the values describe the hour that ended then.
export interface HourSample {
  endMs: number;
  precipMm: number | null;
  windKph: number | null;
  gustKph: number | null;
}

export interface WeatherAlert {
  headline: string;
  event?: string;
  severity?: string;
  effectiveMs?: number;
  expiresMs?: number;
}

export interface PointObservation {
  point: GeoPoint;
  hours: HourSample[];
  alerts: WeatherAlert[];
  error?: string; // set when this place could not be looked up
}

export type WeatherSource = "LIVE" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface WeatherFetchResult {
  provider: string;
  source: WeatherSource;
  // Short, honest description of what kind of data this is, shown to officers.
  dataKind: "MODEL_ANALYSIS" | "STATION_OR_MODEL" | "NONE";
  note?: string;
  points: PointObservation[];
}
