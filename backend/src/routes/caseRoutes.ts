import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getCaseTimeline } from "../controllers/caseController";

const router = Router();

// Any logged-in user may ask; the controller decides whether this
// particular user is allowed to see this particular case.
router.use(authenticate);
router.get("/:bookingId/timeline", getCaseTimeline);

export default router;
