import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { listActiveCrops, listAllCrops, createCrop, updateCrop } from "../controllers/cropController";

const router = Router();

// Public: the list of crops that can currently be booked.
router.get("/", listActiveCrops);

// Staff only below.
router.get("/all", authenticate, authorize("ADMIN", "MANAGER", "OPERATOR", "GATE_OFFICER", "DOCUMENT_OFFICER", "QUALITY_OFFICER", "WEIGHT_OFFICER", "PROCUREMENT_OFFICER", "PAYMENT_OFFICER"), listAllCrops);
router.post("/", authenticate, authorize("ADMIN", "MANAGER", "PROCUREMENT_OFFICER"), createCrop);
router.patch("/:id", authenticate, authorize("ADMIN", "MANAGER", "PROCUREMENT_OFFICER"), updateCrop);

export default router;
