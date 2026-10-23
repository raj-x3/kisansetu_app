import { Router } from "express";
import { listCentres, getCentre } from "../controllers/centreController";

const router = Router();

// Public: anyone booking a slot needs to see centres before logging
// in to see the details of the booking flow itself doesn't need this
// gated — the booking action itself is what requires authentication.
router.get("/", listCentres);
router.get("/:id", getCentre);

export default router;
