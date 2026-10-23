import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { getMyPosition, callNext } from "../controllers/queueController";

const router = Router();

router.use(authenticate);

router.get("/my-position", authorize("FARMER"), getMyPosition);
router.post("/call-next", authorize("OPERATOR", "MANAGER"), callNext);

export default router;
