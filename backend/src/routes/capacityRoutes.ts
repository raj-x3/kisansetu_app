import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { getOverview, listCapacityBookings, setSlotCapacity } from "../controllers/capacityController";

const router = Router();
router.use(authenticate);

// Every staff role can look at their centre's capacity and bookings.
const STAFF = [
  "ADMIN", "MANAGER", "OPERATOR", "GATE_OFFICER", "DOCUMENT_OFFICER",
  "QUALITY_OFFICER", "WEIGHT_OFFICER", "PROCUREMENT_OFFICER", "PAYMENT_OFFICER",
] as const;
router.get("/overview", authorize(...STAFF), getOverview);
router.get("/bookings", authorize(...STAFF), listCapacityBookings);

// Only admin, manager and the procurement officer can change capacity.
router.put("/slot", authorize("ADMIN", "MANAGER", "PROCUREMENT_OFFICER"), setSlotCapacity);

export default router;
