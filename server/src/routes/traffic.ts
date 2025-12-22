import { Router, Request, Response } from "express";
import { TrafficService } from "../services/traffic.js";
import { db, trafficEvents } from "../db/index.js";
import { gte, lte, and, sql } from "drizzle-orm";

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

    const ipAddress = 
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      req.socket.remoteAddress ||
      "unknown";
    
    const userAgent = req.headers["user-agent"] || "unknown";

    trafficService.recordHit(targetDate, ipAddress, userAgent);

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

  // Export events as CSV (streaming for large datasets)
  router.get("/export/csv", async (req: Request, res: Response) => {
    try {
      const startDateStr = req.query.start as string;
      const endDateStr = req.query.end as string;

      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (startDateStr) {
        startDate = new Date(startDateStr);
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid start date format (use YYYY-MM-DD)",
          });
        }
      }

      if (endDateStr) {
        endDate = new Date(endDateStr);
        endDate.setHours(23, 59, 59, 999); // End of day
        if (isNaN(endDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid end date format (use YYYY-MM-DD)",
          });
        }
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="traffic-events-${new Date().toISOString().split("T")[0]}.csv"`
      );

      // Write CSV header
      res.write("Timestamp,IP Address,User Agent,Source,Metadata\n");

      // Stream events in batches to handle millions of rows efficiently
      const BATCH_SIZE = 5000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = db.select().from(trafficEvents);
        
        if (startDate || endDate) {
          const conditions: any[] = [];
          if (startDate) {
            conditions.push(gte(trafficEvents.timestamp, startDate));
          }
          if (endDate) {
            conditions.push(lte(trafficEvents.timestamp, endDate));
          }
          if (conditions.length > 0) {
            query = query.where(and(...conditions)) as any;
          }
        }

        const events = await query
          .orderBy(trafficEvents.timestamp)
          .limit(BATCH_SIZE)
          .offset(offset);

        if (events.length === 0) {
          hasMore = false;
          break;
        }

        for (const event of events) {
          const timestamp = event.timestamp.toISOString();
          const ipAddress = (event.ipAddress || "").replace(/"/g, '""');
          const userAgent = (event.userAgent || "").replace(/"/g, '""');
          const source = (event.source || "").replace(/"/g, '""');
          const metadata = (event.metadata || "").replace(/"/g, '""');

          res.write(
            `"${timestamp}","${ipAddress}","${userAgent}","${source}","${metadata}"\n`
          );
        }

        if (events.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      }

      res.end();
    } catch (err) {
      console.error("Error exporting CSV:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Failed to export CSV" });
      }
    }
  });

  // Export events as PDF (Summary Report)
  router.get("/export/pdf", async (req: Request, res: Response) => {
    try {
      const startDateStr = req.query.start as string;
      const endDateStr = req.query.end as string;

      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (startDateStr) {
        startDate = new Date(startDateStr);
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid start date format (use YYYY-MM-DD)",
          });
        }
      }

      if (endDateStr) {
        endDate = new Date(endDateStr);
        endDate.setHours(23, 59, 59, 999);
        if (isNaN(endDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid end date format (use YYYY-MM-DD)",
          });
        }
      }

      // Get all events for summary statistics
      const events = await trafficService.getAllEvents(startDate, endDate);

      // Calculate summary statistics
      const totalEvents = events.length;
      const uniqueIPs = new Set(events.map(e => e.ipAddress).filter(Boolean)).size;
      const uniqueUserAgents = new Set(events.map(e => e.userAgent).filter(Boolean)).size;
      
      // Top 10 IP addresses
      const ipCounts = new Map<string, number>();
      events.forEach(e => {
        if (e.ipAddress) {
          ipCounts.set(e.ipAddress, (ipCounts.get(e.ipAddress) || 0) + 1);
        }
      });
      const topIPs = Array.from(ipCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      // Top 10 User Agents
      const uaCounts = new Map<string, number>();
      events.forEach(e => {
        if (e.userAgent) {
          uaCounts.set(e.userAgent, (uaCounts.get(e.userAgent) || 0) + 1);
        }
      });
      const topUserAgents = Array.from(uaCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      // Date range
      const dateRange = startDate && endDate 
        ? `${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`
        : "All time";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="traffic-summary-${new Date().toISOString().split("T")[0]}.pdf"`
      );

      // Generate PDF summary report
      const summaryText = `
TRAFFIC EVENTS SUMMARY REPORT
Generated: ${new Date().toISOString()}

OVERVIEW
--------
Total Events: ${totalEvents.toLocaleString()}
Unique IP Addresses: ${uniqueIPs.toLocaleString()}
Unique User Agents: ${uniqueUserAgents.toLocaleString()}
Date Range: ${dateRange}

TOP 10 IP ADDRESSES
-------------------
${topIPs.map(([ip, count], i) => `${i + 1}. ${ip} - ${count.toLocaleString()} requests`).join("\n")}

TOP 10 USER AGENTS
------------------
${topUserAgents.map(([ua, count], i) => `${i + 1}. ${ua.substring(0, 80)}${ua.length > 80 ? "..." : ""} - ${count.toLocaleString()} requests`).join("\n")}

NOTE: Full detailed data is available in CSV export.
`;

      // Simple PDF generation with summary
      const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 5 0 R
>>
>>
>>
endobj
4 0 obj
<<
/Length ${summaryText.length * 10}
>>
stream
BT
/F1 14 Tf
50 750 Td
(TRAFFIC EVENTS SUMMARY REPORT) Tj
0 -25 Td
/F1 10 Tf
(Generated: ${new Date().toISOString()}) Tj
0 -30 Td
/F1 12 Tf
(OVERVIEW) Tj
0 -20 Td
/F1 10 Tf
(Total Events: ${totalEvents.toLocaleString()}) Tj
0 -15 Td
(Unique IP Addresses: ${uniqueIPs.toLocaleString()}) Tj
0 -15 Td
(Unique User Agents: ${uniqueUserAgents.toLocaleString()}) Tj
0 -15 Td
(Date Range: ${dateRange}) Tj
0 -30 Td
/F1 12 Tf
(TOP 10 IP ADDRESSES) Tj
0 -20 Td
/F1 10 Tf
${topIPs.map(([ip, count], i) => `${i + 1}. ${ip} - ${count.toLocaleString()} requests`).join(" Tj\n0 -15 Td\n")} Tj
0 -30 Td
/F1 12 Tf
(TOP 10 USER AGENTS) Tj
0 -20 Td
/F1 10 Tf
${topUserAgents.map(([ua, count], i) => `${i + 1}. ${ua.substring(0, 60)}${ua.length > 60 ? "..." : ""} - ${count.toLocaleString()}`).join(" Tj\n0 -15 Td\n")} Tj
0 -30 Td
/F1 9 Tf
(Note: Full detailed data is available in CSV export.) Tj
ET
endstream
endobj
5 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000300 00000 n
000000${String(summaryText.length * 10).padStart(10, "0")} 00000 n
trailer
<<
/Size 6
/Root 1 0 R
>>
startxref
${summaryText.length * 10 + 400}
%%EOF`;

      res.send(Buffer.from(pdfContent));
    } catch (err) {
      console.error("Error exporting PDF:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Failed to export PDF" });
      }
    }
  });

  return router;
}
