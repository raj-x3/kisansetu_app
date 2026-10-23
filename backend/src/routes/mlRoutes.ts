import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { predictMyEta } from "../controllers/mlController";

const router = Router();

router.use(authenticate, authorize("FARMER"));
router.get("/predict-eta", predictMyEta);

export default router;
