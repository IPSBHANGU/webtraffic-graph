import "./env";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { and, gte, lte, sql } from "drizzle-orm";

async function main() {
  const { config } = await import("./config");
  const { TrafficService } = await import("./services/traffic");
  const { WebSocketManager } = await import("./websocket");
  const { createTrafficRouter } = await import("./routes/traffic");
  const { shutdownQueues } = await import("./queues/event.queue");
  const { shutdownRedis, counterClient } = await import("./redis");
  const {
    db,
    trafficDaily,
    trafficEvents,
    trafficHourly,
    trafficMinute,
    trafficRealtime,
    trafficWeekly,
    trafficMonthly,
  } = await import("./db");

  console.log("🚀 Starting server...");

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.set("trust proxy", true);

  app.use((req, res, next) => {
    const xff = req.headers["x-forwarded-for"];
    const realIp = Array.isArray(xff) ? xff[0] : xff?.split(",")[0];

    req.clientIp = realIp || req.socket.remoteAddress || req.ip;

    // normalize IPv6-mapped IPv4
    if (req.clientIp?.startsWith("::ffff:")) {
      req.clientIp = req.clientIp.replace("::ffff:", "");
    }

    next();
  });

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path !== "/health") {
        console.log(
          `${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`
        );
      }
    });
    next();
  });

  const trafficService = new TrafficService();
  const server = createServer(app);
  const wsManager = new WebSocketManager(server, trafficService);

  app.use("/api", createTrafficRouter(trafficService));

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      clients: wsManager.getClientCount(),
      pending: trafficService.getPendingCount(),
      queueBuffer: trafficService.getQueueBufferSize(),
      wsSubscriptionActive: wsManager.isSubscriptionActive(),
    });
  });

  app.get("/", (req, res) => {
    res.json({
      name: "Web Traffic API",
      endpoints: {
        "POST /api/hit": "Record a visit",
        "POST /api/hits": "Record multiple visits",
        "GET /api/traffic": "Get chart data",
      },
    });
  });

  app.post("/notify", async (req, res) => {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message required" });
    }

    try {
      const response = await fetch(`https://ntfy.sh/realtime_web_traffic`, {
        method: "POST",
        headers: {
          Title: "Real-time Web Traffic Notification",
          Priority: "4",
        },
        body: message,
      });

      if (!response.ok) {
        throw new Error("Failed to send ntfy notification");
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reset endpoint - clears all traffic data from DB and Redis
  app.post("/api/reset", async (req, res) => {
    const confirmKey = req.headers["x-confirm-reset"];

    // Require confirmation header to prevent accidental resets
    if (confirmKey !== "CONFIRM_RESET_ALL_DATA") {
      return res.status(400).json({
        error: "Missing confirmation header",
        hint: "Add header: x-confirm-reset: CONFIRM_RESET_ALL_DATA",
      });
    }

    try {
      console.log("🗑️  Resetting all traffic data...");

      // Clear all database tables
      await db.delete(trafficMinute).execute();
      await db.delete(trafficHourly).execute();
      await db.delete(trafficDaily).execute();
      await db.delete(trafficWeekly).execute();
      await db.delete(trafficMonthly).execute();
      await db.delete(trafficEvents).execute();
      await db.delete(trafficRealtime).execute();

      // Clear Redis counters (keys matching traffic:*)
      const keys = await counterClient.keys("traffic:*");
      if (keys.length > 0) {
        await counterClient.del(...keys);
      }

      console.log("✅ All traffic data cleared!");

      res.json({
        success: true,
        message: "All traffic data cleared",
        tablesCleared: [
          "traffic_minute",
          "traffic_hourly",
          "traffic_daily",
          "traffic_weekly",
          "traffic_monthly",
          "traffic_events",
          "traffic_realtime",
        ],
        redisKeysCleared: keys.length,
      });
    } catch (err: any) {
      console.error("Reset failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/reset/redis", async (req, res) => {
    const confirmKey = req.headers["x-confirm-reset"];

    // Require confirmation header to prevent accidental resets
    if (confirmKey !== "CONFIRM_RESET_ALL_DATA") {
      return res.status(400).json({
        error: "Missing confirmation header",
        hint: "Add header: x-confirm-reset: CONFIRM_RESET_ALL_DATA",
      });
    }

    try {
      console.log("🗑️  Resetting all redis data...");
      // Clear Redis counters (keys matching traffic:*)
      const keys = await counterClient.keys("traffic:*");
      if (keys.length > 0) {
        await counterClient.del(...keys);
      }

      console.log("✅ All traffic data cleared!");

      res.json({
        success: true,
        message: "All traffic data cleared",
        tablesCleared: [
          "traffic_minute",
          "traffic_hourly",
          "traffic_daily",
          "traffic_weekly",
          "traffic_monthly",
          "traffic_events",
          "traffic_realtime",
        ],
        redisKeysCleared: keys.length,
      });
    } catch (err: any) {
      console.error("Reset failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Sync Redis counters from database
  app.post("/api/sync", async (req, res) => {
    try {
      console.log("🔄 Syncing Redis counters from database...");

      // Clear existing Redis traffic counters
      const keys = await counterClient.keys("traffic:counter:*");
      if (keys.length > 0) {
        await counterClient.del(...keys);
      }

      // Get last 7 days of data from DB and populate Redis
      const now = new Date();
      let totalSynced = 0;

      for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const dateEnd = new Date(date);
        dateEnd.setHours(23, 59, 59, 999);

        // Get count from trafficMinute table
        const result = await db
          .select({
            total: sql<number>`COALESCE(SUM(${trafficMinute.count}), 0)`,
          })
          .from(trafficMinute)
          .where(
            and(
              gte(trafficMinute.timestamp, date),
              lte(trafficMinute.timestamp, dateEnd)
            )
          );

        const count = Number(result[0]?.total) || 0;

        if (count > 0) {
          const dateStr = `${date.getFullYear()}-${String(
            date.getMonth() + 1
          ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          await counterClient.set(
            `traffic:counter:${dateStr}`,
            count.toString()
          );
          await counterClient.expire(
            `traffic:counter:${dateStr}`,
            8 * 24 * 60 * 60
          );
          totalSynced += count;
        }
      }

      console.log(`✅ Synced ${totalSynced} total from DB to Redis`);

      res.json({
        success: true,
        message: "Redis synced from database",
        totalSynced,
      });
    } catch (err: any) {
      console.error("Sync failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  const shutdown = async () => {
    console.log("\n👋 Shutting down...");
    await wsManager.shutdown();
    await trafficService.shutdown();
    await shutdownQueues();
    await shutdownRedis();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(config.port, () => {
    console.log(`\n✅ Server running at http://localhost:${config.port}`);
    console.log(`📡 WebSocket at ws://localhost:${config.port}`);
    console.log("\nTest: curl -X POST http://localhost:3001/api/hit\n");
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
