import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { rateLimit } from "../utils/rateLimit";
import { join, mine, withdraw, entryOffers, accept, decline, officerList, officerRedistribute, officerPause, officerOfferWindow } from "../controllers/waitlistController";

// Farmer side. Mounted at /api/waitlist
export const waitlistRouter = Router();
waitlistRouter.use(authenticate, authorize("FARMER"));
waitlistRouter.get("/me", mine);
waitlistRouter.post("/", rateLimit("waitlist-join", () => 30), join);
waitlistRouter.get("/:id/offers", entryOffers);
waitlistRouter.delete("/:id", withdraw);

// Mounted at /api/slot-offers
export const slotOfferRouter = Router();
slotOfferRouter.use(authenticate, authorize("FARMER"));
slotOfferRouter.post("/:id/accept", rateLimit("offer-accept", () => 60), accept);
slotOfferRouter.post("/:id/decline", rateLimit("offer-decline", () => 60), decline);

// Officer side. Mounted at /api/officer/waitlist
// Staff may only work on their own centre (checked in the controller).
export const officerWaitlistRouter = Router();
officerWaitlistRouter.use(authenticate);
const WL_STAFF = ["ADMIN", "MANAGER", "OPERATOR", "PROCUREMENT_OFFICER"] as const;
officerWaitlistRouter.get("/:centreId", authorize(...WL_STAFF), officerList);
officerWaitlistRouter.post("/:centreId/redistribute", authorize(...WL_STAFF), rateLimit("wl-redistribute", () => 60), officerRedistribute);
officerWaitlistRouter.post("/:centreId/pause", authorize(...WL_STAFF), officerPause);
officerWaitlistRouter.put("/:centreId/offer-window", authorize("ADMIN", "MANAGER"), officerOfferWindow);
