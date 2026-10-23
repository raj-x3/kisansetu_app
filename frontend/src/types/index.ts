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
  tokenNumber: number;
  crop: string;
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
