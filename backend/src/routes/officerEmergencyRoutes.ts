import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { rateLimit } from "../utils/rateLimit";
import { listForOfficers, getForOfficers, reviewRequest, reverify } from "../controllers/emergencyController";

// Mounted at /api/officer/emergency-requests
// Only the admin, the centre manager and the document officer may work with
// emergency requests. Every other officer role gets "no permission".
const router = Router();
router.use(authenticate);
router.use(authorize("ADMIN", "MANAGER", "DOCUMENT_OFFICER"));

router.get("/", listForOfficers);
router.get("/:id", getForOfficers);
router.patch("/:id/review", rateLimit("emergency-review", () => 200), reviewRequest);
router.post("/:id/reverify", rateLimit("emergency-reverify", () => 60), reverify);

export default router;
