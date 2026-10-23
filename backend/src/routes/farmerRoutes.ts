import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { getMyProfile } from "../controllers/farmerController";

const router = Router();

// Every route below requires a valid login token AND the FARMER role.
router.use(authenticate, authorize("FARMER"));

router.get("/me", getMyProfile);

export default router;
