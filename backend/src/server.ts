// This is the file you run to start the backend server.
// It:
//   1. Loads environment variables from .env
//   2. Sets up Express (handles HTTP requests)
//   3. Initializes Socket.IO (see socket.ts) for real-time queue updates
//   4. Mounts all route groups
//   5. Adds error handling so the app never crashes on a bad request

import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { initSocket } from "./socket";
import { allowedOrigins } from "./utils/origins";
import { ensureCapacityConstraints } from "./utils/capacityConstraints";

import authRoutes from "./routes/authRoutes";
import farmerRoutes from "./routes/farmerRoutes";
import centreRoutes from "./routes/centreRoutes";
import slotRoutes from "./routes/slotRoutes";
import bookingRoutes from "./routes/bookingRoutes";
import queueRoutes from "./routes/queueRoutes";
import chatRoutes from "./routes/chatRoutes";
import mlRoutes from "./routes/mlRoutes";
import operatorRoutes from "./routes/operatorRoutes";
import adminRoutes from "./routes/adminRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import documentRoutes from "./routes/documentRoutes";
import caseRoutes from "./routes/caseRoutes";
import cropRoutes from "./routes/cropRoutes";
import capacityRoutes from "./routes/capacityRoutes";
import emergencyRoutes from "./routes/emergencyRoutes";
import officerEmergencyRoutes from "./routes/officerEmergencyRoutes";
import { waitlistRouter, slotOfferRouter, officerWaitlistRouter } from "./routes/waitlistRoutes";
import { startBackgroundJobs } from "./services/backgroundJobs";

const app = express();
const server = http.createServer(app);

// Socket.IO attaches to the same server so real-time queue
// updates and normal API requests share one port.
initSocket(server);

app.use(cors({ origin: allowedOrigins() }));
// 4 MB so a 2 MB document (sent as base64 text, ~33% bigger) fits.
app.use(express.json({ limit: "4mb" }));

// Simple request logger — helpful while learning what's happening.
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/farmers", farmerRoutes);
app.use("/api/centres", centreRoutes);
app.use("/api/slots", slotRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/ml", mlRoutes);
app.use("/api/operator", operatorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/crops", cropRoutes);
app.use("/api/capacity", capacityRoutes);
app.use("/api/emergency-cancellations", emergencyRoutes);
app.use("/api/officer/emergency-requests", officerEmergencyRoutes);
app.use("/api/waitlist", waitlistRouter);
app.use("/api/slot-offers", slotOfferRouter);
app.use("/api/officer/waitlist", officerWaitlistRouter);

// --- 404 handler: any URL that doesn't match a route above ---
app.use((req, res) => {
  res.status(404).json({ error: `No route found for ${req.method} ${req.path}` });
});

// --- Central error handler: catches any unexpected error thrown
// in a controller so we NEVER leak a raw stack trace to the user. ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err); // full detail goes to the server log, for you the developer
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
  void ensureCapacityConstraints();
  startBackgroundJobs();
});
