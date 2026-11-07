export type OfficerRole =
  | "GATE_OFFICER"
  | "DOCUMENT_OFFICER"
  | "QUALITY_OFFICER"
  | "WEIGHT_OFFICER"
  | "PROCUREMENT_OFFICER"
  | "PAYMENT_OFFICER";

export type Role = "FARMER" | "OPERATOR" | "ADMIN" | "MANAGER" | OfficerRole;

export interface AuthUser {
  id: string;
  role: Role;
  name?: string;
  farmerCode?: string;
  fullName?: string;
}

export interface FarmerProfile {
  farmerCode: string;
  fullName: string;
  mobile: string;
  address: string;
  district: string;
  state: string;
  preferredCentre: string | null;
}

export type ProcurementStage =
  | "REGISTERED"
  | "SLOT_BOOKED"
  | "ARRIVED"
  | "VERIFIED"
  | "QUALITY_CHECKED"
  | "WEIGHED"
  | "COMPLETED";

export interface FarmerBooking {
  id: string;
  caseId: string;
  centreId: string;
  tokenNumber: number;
  crop: string;
  cropId: string | null;
  quantityKg: number;
  status: "BOOKED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  stage: ProcurementStage;
  date: string;
  startTime: string;
  endTime: string;
  centreName: string;
  qualityResult: "ACCEPTED" | "REJECTED" | null;
  netWeightKg: number | null;
  totalAmount: number | null;
  billReference: string | null;
  paymentStatus: "PENDING" | "INITIATED" | "PROCESSING" | "CREDITED" | "FAILED" | null;
}

// One row of the officers' live queue table (from GET /operator/today).
export interface QueueRow {
  bookingId: string;
  caseId: string;
  tokenNumber: number;
  farmerName: string;
  farmerCode: string;
  crop: string;
  quantityKg: number;
  stage: string;
  qualityResult: "ACCEPTED" | "REJECTED" | null;
  netWeightKg: number | null;
  totalAmount: number | null;
  billReference: string | null;
  paymentStatus: "PENDING" | "INITIATED" | "PROCESSING" | "CREDITED" | "FAILED" | null;
}

export type DocumentType = "IDENTITY_PROOF" | "LAND_RECORD" | "OTHER";
export type DocumentStatus = "PENDING" | "VERIFIED" | "REJECTED" | "CORRECTION_REQUESTED";

// A document's details. The file itself is never in this object —
// it is fetched separately, only when someone clicks View.
export interface CaseDocument {
  id: string;
  bookingId: string;
  type: DocumentType;
  status: DocumentStatus;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// ---------- Weight-based, crop-wise slot capacity ----------

export interface Crop {
  id: string;
  name: string;
  maxBookingKg: number;
}

export type CapacityStatus = "AVAILABLE" | "LIMITED" | "FULL";
export type CapacityRank = "RECOMMENDED" | "ALTERNATIVE" | "NOT_SUITABLE" | "UNRANKED";
export type CapacityReason = "bestFit" | "alsoFits" | "tooSmall" | "full" | "farmerCap" | "none";

// One slot's live capacity for the chosen crop (from GET /slots/recommend).
export interface CapacitySlot {
  slotId: string;
  startTime: string;
  endTime: string;
  maxWeightKg: number;
  bookedWeightKg: number;
  remainingKg: number;
  utilizationPct: number;
  confirmedFarmers: number;
  status: CapacityStatus;
  rank: CapacityRank;
  reason: CapacityReason;
  afterBookingKg: number | null;
}

export interface Recommendation {
  centreId: string;
  cropId: string;
  cropName: string;
  maxBookingKg: number;
  date: string;
  weightKg: number | null;
  slots: CapacitySlot[];
  recommendedSlotId: string | null;
  alternativeDates: { date: string; slot: CapacitySlot }[];
  generatedAt: string;
}

// ---------- Emergency cancellation ----------

export type EmergencyCategory = "HEAVY_RAINFALL" | "FLOODING" | "SEVERE_WEATHER" | "ROAD_BLOCKAGE" | "OTHER";
export type EmergencyStatus =
  | "SUBMITTED"
  | "UNDER_VERIFICATION"
  | "AWAITING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "RESCHEDULING_AVAILABLE"
  | "RESCHEDULED";
export type VerificationResult =
  | "STRONGLY_CORROBORATED"
  | "PARTIALLY_CORROBORATED"
  | "UNABLE_TO_VERIFY"
  | "CONTRADICTORY";

export interface EmergencyEvidenceFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

// What the farmer sees (no officer-only notes).
export interface EmergencyRequestView {
  id: string;
  requestNo: string;
  bookingId: string;
  caseId: string;
  centreName: string;
  crop: string;
  quantityKg: number;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
  category: EmergencyCategory;
  description: string;
  incidentAt: string;
  status: EmergencyStatus;
  verificationResult: VerificationResult | null;
  decision: "APPROVED" | "REJECTED" | null;
  officerRemarks: string | null;
  decidedAt: string | null;
  manualReviewRequested: boolean;
  newBookingId: string | null;
  evidence: EmergencyEvidenceFile[];
  createdAt: string;
  canAddEvidence: boolean;
  canRequestReview: boolean;
  canReschedule: boolean;
}

export interface RescheduleOption {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  remainingKg: number;
  utilizationPct: number;
  afterBookingKg: number;
  recommended: boolean;
}

export interface EmergencyListRow {
  id: string;
  requestNo: string;
  caseId: string;
  centreId: string;
  centreName: string;
  farmerName: string;
  crop: string;
  quantityKg: number;
  slotDate: string;
  slotStart: string;
  category: EmergencyCategory;
  status: EmergencyStatus;
  verificationResult: VerificationResult | null;
  supportScore: number | null;
  flagged: boolean;
  manualReviewRequested: boolean;
  evidenceCount: number;
  createdAt: string;
}

export interface WeatherReason {
  code: string;
  params?: Record<string, string | number>;
}

export interface WeatherPoint {
  label: "farmer" | "centre" | "route" | "area";
  lat: number;
  lng: number;
  dataAvailable: boolean;
  hoursCovered: number;
  forecastHours: number;
  rainTotalMm: number;
  rain24hMaxMm: number;
  rainPeakHourMm: number;
  windMaxKph: number;
  gustMaxKph: number;
  rainLevel: "NONE" | "LIGHT" | "MODERATE" | "SIGNIFICANT";
  strongWind: boolean;
  alerts: { headline: string; event?: string; severity?: string }[];
}

export interface WeatherVerificationRecord {
  id: string;
  provider: string;
  source: "LIVE" | "UNAVAILABLE" | "NOT_CONFIGURED";
  windowStart: string;
  windowEnd: string;
  outcome: VerificationResult;
  supportScore: number;
  reasons: WeatherReason[];
  observations: { note: string | null; dataKind: string; points: WeatherPoint[] };
  createdAt: string;
}

export interface EmergencyDetail extends EmergencyRequestView {
  farmerName: string;
  farmerCode: string;
  tokenNumber: number;
  centreId: string;
  supportScore: number | null;
  flagged: boolean;
  flagReason: string | null;
  farmerReviewNote: string | null;
  affectedLat: number | null;
  affectedLng: number | null;
  earlierRequests90Days: number;
  reviews: { id: string; action: string; officerName: string; remarks: string | null; createdAt: string }[];
  verifications: WeatherVerificationRecord[];
}

// ---------- Live queue and waitlist ----------

export type QueueLevel = "LOW" | "MODERATE" | "HIGH" | "DELAYED" | "PAUSED";
export type QueueStage = "SLOT_BOOKED" | "ARRIVED" | "VERIFIED" | "QUALITY_CHECKED" | "WEIGHED" | "COMPLETED";

export interface WaitEstimate {
  startLowMin: number; // time until processing starts
  startHighMin: number;
  completeLowMin: number; // total time until procurement is complete
  completeHighMin: number;
  workloadMin: number;
  counters: number;
  basis: "MEASURED" | "BASELINE";
}

export interface CentreQueueSummary {
  centreId: string;
  centreName: string;
  location: string;
  isActive: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  delayMinutes: number;
  currentToken: number;
  waiting: number;
  expected: number;
  processing: number;
  completedToday: number;
  counters: number;
  avgProcessingMin: number;
  basis: "MEASURED" | "BASELINE";
  samples: number;
  level: QueueLevel;
  newArrival: WaitEstimate;
}

export type FarmerQueueView =
  | { hasBooking: false }
  | {
      hasBooking: true;
      isToday: boolean;
      bookingId: string;
      centreId: string;
      centreName: string;
      date: string;
      slotStart: string;
      slotEnd: string;
      yourToken: number;
      stage: QueueStage;
      currentToken: number;
      farmersAhead: number;
      waiting: number;
      processing: number;
      level: QueueLevel;
      isPaused: boolean;
      pauseReason: string | null;
      delayMinutes: number;
      delayNote: string | null;
      avgProcessingMin: number;
      counters: number;
      estimate: WaitEstimate | null;
      generatedAt: string;
    };

export interface CongestionHour {
  hour: number;
  expectedArrivals: number;
  capacityFarmers: number;
  predictedQueue: number;
  predictedWaitMin: number;
  utilizationPct: number;
  level: "NORMAL" | "MODERATE" | "HIGH";
  delayRisk: boolean;
}

export interface CongestionForecast {
  centreId: string;
  centreName: string;
  level: QueueLevel;
  isPaused: boolean;
  pauseReason: string | null;
  delayMinutes: number;
  delayNote: string | null;
  activeCountersSetting: number | null;
  currentQueue: number;
  waiting: number;
  processing: number;
  expectedArrivals: number;
  predictedPeakQueue: number;
  estimatedWorkloadMin: number;
  counters: number;
  counterUtilizationPct: number;
  avgProcessingMin: number;
  basis: "MEASURED" | "BASELINE";
  samples: number;
  showUpRate: number;
  showUpBasis: "MEASURED" | "BASELINE";
  outlook: "NORMAL" | "MODERATE" | "HIGH" | "DELAY_RISK";
  hours: CongestionHour[];
  slowestStage: { stage: string; avgMin: number; samples: number } | null;
  backlogStage: { stage: string; count: number } | null;
  method: "BASELINE_SIMULATION";
  generatedAt: string;
}

export type WaitlistStatus = "ACTIVE" | "OFFERED" | "FULFILLED" | "WITHDRAWN" | "EXPIRED";
export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED";

export interface WaitlistEntryView {
  id: string;
  centreId: string;
  centreName: string;
  cropName: string;
  quantityKg: number;
  date: string;
  windowStart: string | null;
  windowEnd: string | null;
  status: WaitlistStatus;
  position: number | null;
  createdAt: string;
  bookingId: string | null;
}

export interface SlotOfferView {
  id: string;
  waitlistId: string;
  status: OfferStatus;
  centreName: string;
  cropName: string;
  quantityKg: number;
  date: string;
  startTime: string;
  endTime: string;
  remainingAfterKg: number | null;
  expiresAt: string;
  createdAt: string;
  bookingId: string | null;
}

export interface FarmerWaitlist {
  entries: WaitlistEntryView[];
  offers: SlotOfferView[];
  now: string;
}

export interface OfficerWaitlistOffer {
  id: string;
  farmerCode: string;
  farmerName: string;
  cropName: string;
  quantityKg: number;
  date: string;
  startTime: string;
  endTime: string;
  status: OfferStatus;
  expiresAt: string;
  createdAt: string;
}

export interface OfficerWaitlist {
  centre: {
    id: string;
    name: string;
    waitlistPaused: boolean;
    waitlistPauseReason: string | null;
    centrePaused: boolean;
    offerWindowMin: number;
  };
  summary: {
    waitingFarmers: number;
    eligibleNow: number;
    pendingOffers: number;
    pendingKg: number;
    releasedKg: number;
    acceptedCount: number;
    acceptedKg: number;
    expiredCount: number;
    declinedCount: number;
    returnedToPublicKg: number;
  };
  byCrop: { cropName: string; waiting: number; totalKg: number }[];
  entries: {
    id: string;
    farmerCode: string;
    farmerName: string;
    cropName: string;
    quantityKg: number;
    date: string;
    windowStart: string | null;
    windowEnd: string | null;
    status: WaitlistStatus;
    position: number | null;
    createdAt: string;
    eligibleSlots: { startTime: string; endTime: string }[];
    whyNot: { reason: string; shortfallKg?: number } | null;
  }[];
  pendingOffers: OfficerWaitlistOffer[];
  recentOffers: OfficerWaitlistOffer[];
  log: {
    id: string;
    event: string;
    trigger: string | null;
    cropName: string;
    slotDate: string | null;
    slotStart: string | null;
    kg: number;
    farmerCode: string | null;
    reason: string | null;
    params: Record<string, unknown> | null;
    actorRole: string | null;
    note: string | null;
    createdAt: string;
  }[];
  generatedAt: string;
}
