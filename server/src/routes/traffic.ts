import { Router, Request, Response } from "express";
import { TrafficService } from "../services/traffic.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function createTrafficRouter(trafficService: TrafficService) {
  const router = Router();

  router.post("/hit", (req: Request, res: Response) => {
    const dateStr = req.query.date as string;
    let targetDate: Date | undefined;

    if (dateStr) {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        targetDate = new Date(year, month, day, 12, 0, 0);
      }

      if (!targetDate || isNaN(targetDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format (use YYYY-MM-DD)",
        });
      }
    }

    trafficService.recordHit(targetDate);

    const actualDate = targetDate || new Date();
    res.status(202).json({
      success: true,
      day: DAY_NAMES[actualDate.getDay()],
      date: dateStr || new Date().toISOString().split("T")[0],
    });
  });

  router.get("/traffic", async (req: Request, res: Response) => {
    try {
      const [data, total, currentDay] = await Promise.all([
        trafficService.getLast7Days(),
        trafficService.getTotalTraffic(),
        trafficService.getTodayTraffic(),
      ]);

      res.json({
        success: true,
        data,
        total,
        currentDay,
        percentageChange: 0,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Error fetching traffic:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch traffic data" });
    }
  });

  router.get("/stats", async (req: Request, res: Response) => {
    try {
      const [total, currentDay] = await Promise.all([
        trafficService.getTotalTraffic(),
        trafficService.getTodayTraffic(),
      ]);

      res.json({
        success: true,
        total,
        currentDay,
        pending: trafficService.getPendingCount(),
      });
    } catch {
      res.status(500).json({ success: false, error: "Failed to fetch stats" });
    }
  });

  return router;
}
