import { Router } from "express";
import { getSlots } from "../controllers/slotController";

const router = Router();

// Public read access — a farmer should be able to see availability
// before committing to log in or register.
router.get("/", getSlots);

export default router;
