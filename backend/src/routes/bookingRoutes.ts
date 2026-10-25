import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { createBooking, getMyBookings, cancelBooking, rescheduleBooking } from "../controllers/bookingController";

const router = Router();

router.use(authenticate, authorize("FARMER"));

router.post("/", createBooking);
router.get("/my", getMyBookings);
router.post("/:id/cancel", cancelBooking);
router.post("/:id/reschedule", rescheduleBooking);

export default router;
