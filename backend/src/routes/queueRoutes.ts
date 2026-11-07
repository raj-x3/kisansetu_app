import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getMyPosition,
  callNext,
  listCentres,
  getCentreStatus,
  getMyEstimate,
  getTokenEstimate,
  getCongestion,
  updateCentreStatus,
  getMyCentre,
} from "../controllers/queueController";

const router = Router();

router.use(authenticate);

router.get("/my-position", authorize("FARMER"), getMyPosition);
router.post("/call-next", authorize("OPERATOR", "MANAGER"), callNext);

// Live queue and estimates. Order matters: fixed paths come before :centreId.
router.get("/centres", listCentres);
router.get("/centres/:centreId", getCentreStatus);
router.get("/farmer/me", authorize("FARMER"), getMyEstimate);

const STAFF = ["ADMIN", "MANAGER", "OPERATOR", "GATE_OFFICER", "DOCUMENT_OFFICER", "QUALITY_OFFICER", "WEIGHT_OFFICER", "PROCUREMENT_OFFICER", "PAYMENT_OFFICER"] as const;
router.get("/my-centre", authorize(...STAFF), getMyCentre);
router.get("/:centreId/estimate/:tokenNumber", authorize(...STAFF), getTokenEstimate);
router.get("/:centreId/congestion", authorize(...STAFF), getCongestion);
router.get("/:centreId/predictions", authorize(...STAFF), getCongestion);
router.patch("/:centreId/status", authorize("ADMIN", "MANAGER", "OPERATOR"), updateCentreStatus);

export default router;
