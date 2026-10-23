import { Router } from "express";
import { sendMessage } from "../controllers/chatController";

const router = Router();

// Public on purpose: the chat widget appears on every page, including
// the landing page before someone has registered or logged in.
router.post("/message", sendMessage);

export default router;
