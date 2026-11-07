import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { createBooking, getMyBookings, cancelBooking, rescheduleBooking, changeBookingWeight } from "../controllers/bookingController";

const router = Router();

router.use(authenticate, authorize("FARMER"));

router.post("/", createBooking);
router.get("/my", getMyBookings);
router.post("/:id/cancel", cancelBooking);
router.post("/:id/reschedule", rescheduleBooking);
router.post("/:id/weight", changeBookingWeight);

export default router;
