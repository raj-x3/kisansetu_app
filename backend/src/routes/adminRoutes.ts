import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { getAnalytics, listAllCentres, createCentre, updateCentre, getAuditLogs, getInsights, createStaffUser } from "../controllers/adminController";
import {
  simulateAddFarmers,
  simulateCongestion,
  simulateCallNext,
  simulateCompleteStage,
  simulatePayment,
  simulateReset,
} from "../controllers/simulationController";

const router = Router();

router.use(authenticate);

// ADMIN and MANAGER can view analytics, insights, audit and edit centres.
router.get("/analytics", authorize("ADMIN", "MANAGER"), getAnalytics);
router.get("/centres", authorize("ADMIN", "MANAGER"), listAllCentres);
router.put("/centres/:id", authorize("ADMIN", "MANAGER"), updateCentre);
router.get("/audit-logs", authorize("ADMIN", "MANAGER"), getAuditLogs);
router.get("/insights", authorize("ADMIN", "MANAGER"), getInsights);

// ADMIN only.
router.post("/centres", authorize("ADMIN"), createCentre);
router.post("/users", authorize("ADMIN"), createStaffUser);

// Simulation Mode — see simulationService.ts for the safety rules
// these all follow (SIM- farmers only, one clearly-flagged exception).
router.post("/simulate/add-farmers", authorize("ADMIN"), simulateAddFarmers);
router.post("/simulate/congestion", authorize("ADMIN"), simulateCongestion);
router.post("/simulate/call-next", authorize("ADMIN"), simulateCallNext);
router.post("/simulate/complete-stage", authorize("ADMIN"), simulateCompleteStage);
router.post("/simulate/payment", authorize("ADMIN"), simulatePayment);
router.post("/simulate/reset", authorize("ADMIN"), simulateReset);

export default router;
