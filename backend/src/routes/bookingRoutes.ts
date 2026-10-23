import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { createBooking, getMyBookings } from "../controllers/bookingController";

const router = Router();

router.use(authenticate, authorize("FARMER"));

router.post("/", createBooking);
router.get("/my", getMyBookings);

export default router;
