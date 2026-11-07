import { Router } from "express";
import { getSlots, getRecommendedSlots } from "../controllers/slotController";

const router = Router();

// Public read access — a farmer should be able to see availability
// before committing to log in or register.
router.get("/", getSlots);
router.get("/recommend", getRecommendedSlots);

export default router;
