import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { uploadDocument, listDocuments, getDocumentFile, reviewDocument } from "../controllers/documentController";

const router = Router();

router.use(authenticate);

// Only the farmer who owns the booking can upload.
router.post("/booking/:bookingId", authorize("FARMER"), uploadDocument);
// The farmer (own booking) or the document desk at that centre can list/open.
router.get("/booking/:bookingId", authorize("FARMER", "DOCUMENT_OFFICER", "OPERATOR"), listDocuments);
router.get("/:id/file", authorize("FARMER", "DOCUMENT_OFFICER", "OPERATOR"), getDocumentFile);
// Only the document desk reviews.
router.post("/:id/review", authorize("DOCUMENT_OFFICER", "OPERATOR"), reviewDocument);

export default router;
