import { Router } from "express";
import { register, login } from "../controllers/authController";

const router = Router();

// These two routes are public — no login token required to reach them,
// since their whole purpose is to CREATE a login token.
router.post("/register", register);
router.post("/login", login);

export default router;
