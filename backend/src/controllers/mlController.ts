// The Node backend never invents a waiting-time number itself — it
// gathers the real, current facts about a farmer's situation (how many
// people are ahead of them, how many machines/operators their centre
// has active, what hour it is) and asks the Python ML service to
// predict from those facts. This keeps the actual machine learning
// logic in one place (Python), while Node stays the source of truth
// for what's really happening in the database.

import { Request, Response } from "express";
import { prisma } from "../utils/prismaClient";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export async function predictMyEta(req: Request, res: Response) {
  const userId = req.user!.userId;
  const farmer = await prisma.farmer.findUnique({ where: { userId } });
  if (!farmer) return res.status(404).json({ error: "Farmer profile not found." });

  const booking = await prisma.booking.findFirst({
    where: { farmerId: farmer.id, status: "BOOKED" },
    include: { slot: { include: { centre: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (!booking) {
    return res.status(404).json({ error: "You don't have an active booking to estimate a wait time for." });
  }

  const centre = booking.slot.centre;

  const farmersAhead = await prisma.booking.count({
    where: {
      status: "BOOKED",
      slot: { centreId: centre.id, date: booking.slot.date },
      tokenNumber: { gt: centre.currentToken, lt: booking.tokenNumber },
    },
  });

  // Demand/activity signal for the ETA model — should reflect the
  // day's real booking volume, not just who's still mid-workflow.
  const totalArrivedToday = await prisma.booking.count({
    where: { status: { not: "CANCELLED" }, slot: { centreId: centre.id, date: booking.slot.date } },
  });

  const features = {
    queue_length: farmersAhead,
    active_machines: centre.numMachines,
    active_operators: centre.numOperators,
    hour: new Date().getHours(),
    farmers_arrived: totalArrivedToday,
    average_processing_time: centre.avgProcessingMin,
  };

  try {
    const response = await fetch(`${ML_SERVICE_URL}/predict-eta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(features),
    });

    if (!response.ok) {
      throw new Error(`ML service responded with ${response.status}`);
    }

    const data = await response.json();
    const predictedMinutes: number = data.predicted_waiting_time;

    // Store the prediction for the record, per the schema's
    // ml_predictions table — useful later for admin analytics.
    await prisma.mlPrediction.create({
      data: {
        centreId: centre.id,
        queueLength: features.queue_length,
        activeMachines: features.active_machines,
        activeOperators: features.active_operators,
        hour: features.hour,
        farmersArrived: features.farmers_arrived,
        averageProcessingTime: features.average_processing_time,
        predictedWaitingMinutes: predictedMinutes,
      },
    });

    return res.json({ predictedWaitingMinutes: predictedMinutes });
  } catch (err) {
    console.error("ML service call failed:", err);
    return res.status(503).json({
      error: "The AI wait-time estimator isn't reachable right now. Make sure the ML service is running.",
    });
  }
}
