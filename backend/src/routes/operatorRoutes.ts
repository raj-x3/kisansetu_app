import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getTodayQueue,
  searchQueue,
  markArrived,
  markVerified,
  submitQualityCheck,
  submitWeighing,
  completeProcurement,
  initiatePayment,
  processPayment,
  creditPayment,
  failPayment,
} from "../controllers/operatorController";

const router = Router();

router.use(authenticate);

// Separation of duties: each officer role can do ONLY its own step.
// The legacy OPERATOR role can still do every step (old demo logins).
// The backend enforces this — the frontend only hides buttons.
const ANY_OFFICER = [
  "OPERATOR", "MANAGER", "GATE_OFFICER", "DOCUMENT_OFFICER",
  "QUALITY_OFFICER", "WEIGHT_OFFICER", "PROCUREMENT_OFFICER", "PAYMENT_OFFICER",
] as const;

router.get("/today", authorize(...ANY_OFFICER), getTodayQueue);
router.get("/search", authorize(...ANY_OFFICER), searchQueue);
router.post("/arrive/:bookingId", authorize("OPERATOR", "GATE_OFFICER"), markArrived);
router.post("/verify/:bookingId", authorize("OPERATOR", "DOCUMENT_OFFICER"), markVerified);
router.post("/quality-check/:bookingId", authorize("OPERATOR", "QUALITY_OFFICER"), submitQualityCheck);
router.post("/weigh/:bookingId", authorize("OPERATOR", "WEIGHT_OFFICER"), submitWeighing);
router.post("/complete/:bookingId", authorize("OPERATOR", "PROCUREMENT_OFFICER"), completeProcurement);
router.post("/payment/:bookingId/initiate", authorize("OPERATOR", "PAYMENT_OFFICER"), initiatePayment);
router.post("/payment/:bookingId/process", authorize("OPERATOR", "PAYMENT_OFFICER"), processPayment);
router.post("/payment/:bookingId/credit", authorize("OPERATOR", "PAYMENT_OFFICER"), creditPayment);
router.post("/payment/:bookingId/fail", authorize("OPERATOR", "PAYMENT_OFFICER"), failPayment);

export default router;
