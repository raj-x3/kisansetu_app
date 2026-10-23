import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { listMine, markAllRead } from "../controllers/notificationController";

const router = Router();

router.use(authenticate, authorize("FARMER"));

router.get("/", listMine);
router.post("/read-all", markAllRead);

export default router;
