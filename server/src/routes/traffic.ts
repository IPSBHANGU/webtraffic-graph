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
      const [data, total, currentDay, hourlyData, weeklyData, monthlyData] = await Promise.all([
        trafficService.getLast7Days(),
        trafficService.getTotalTraffic(),
        trafficService.getTodayTraffic(),
        trafficService.getHourlyData(),
        trafficService.getWeeklyData(),
        trafficService.getMonthlyData(),
      ]);

      res.json({
        success: true,
        data, // Daily data (last 7 days)
        hourlyData, // Hourly data for today
        weeklyData, // Weekly aggregated data
        monthlyData, // Monthly aggregated data
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

  // Custom date range query
  router.get("/custom-range", async (req: Request, res: Response) => {
    try {
      const startDate = req.query.start as string;
      const endDate = req.query.end as string;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: "start and end date parameters are required (YYYY-MM-DD format)",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format (use YYYY-MM-DD)",
        });
      }

      const data = await trafficService.getCustomDateRangeData(start, end);
      const total = data.reduce((sum, d) => sum + d.traffic, 0);

      res.json({
        success: true,
        data,
        total,
        startDate,
        endDate,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Error fetching custom range:", err);
      res.status(500).json({ success: false, error: "Failed to fetch custom range data" });
    }
  });

  // Multiple specific dates query
  router.post("/custom-dates", async (req: Request, res: Response) => {
    try {
      const { dates } = req.body;

      if (!dates || !Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({
          success: false,
          error: "dates array is required in request body",
        });
      }

      const parsedDates = dates.map((d: string) => new Date(d));
      
      if (parsedDates.some((d: Date) => isNaN(d.getTime()))) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format in array (use YYYY-MM-DD)",
        });
      }

      const data = await trafficService.getMultipleDatesData(parsedDates);
      const total = data.reduce((sum, d) => sum + d.traffic, 0);

      res.json({
        success: true,
        data,
        total,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Error fetching custom dates:", err);
      res.status(500).json({ success: false, error: "Failed to fetch custom dates data" });
    }
  });

  return router;
}
