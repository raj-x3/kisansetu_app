import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { rateLimit } from "../utils/rateLimit";
import { emergencyConfig } from "../config/emergency";
import {
  createEmergency, listMine, listForFarmerId, getOwn, addEvidence, getEvidenceFile, requestManualReview,
  getRescheduleOptions, rescheduleAfterEmergency, getWeatherVerification,
} from "../controllers/emergencyController";

// Mounted at /api/emergency-cancellations
const router = Router();
router.use(authenticate);

const REVIEWERS = ["ADMIN", "MANAGER", "DOCUMENT_OFFICER"] as const;
const submitLimit = rateLimit("emergency-submit", () => emergencyConfig().submitPerHour);
const actionLimit = rateLimit("emergency-action", () => emergencyConfig().actionPerHour);

router.post("/", authorize("FARMER"), submitLimit, createEmergency);
router.get("/mine", authorize("FARMER"), listMine);
router.get("/farmer/:farmerId", authorize("FARMER"), listForFarmerId);
router.get("/:id", authorize("FARMER"), getOwn);
router.post("/:id/evidence", authorize("FARMER"), actionLimit, addEvidence);
router.get("/:id/evidence/:evidenceId/file", authorize("FARMER", ...REVIEWERS), getEvidenceFile);
router.post("/:id/manual-review", authorize("FARMER"), actionLimit, requestManualReview);
router.get("/:id/reschedule-options", authorize("FARMER"), getRescheduleOptions);
router.post("/:id/reschedule", authorize("FARMER"), actionLimit, rescheduleAfterEmergency);
router.get("/:id/weather-verification", authorize(...REVIEWERS), getWeatherVerification);

export default router;
