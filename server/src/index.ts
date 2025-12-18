import "./env.js";
import express from "express";
import cors from "cors";
import { createServer } from "http";

async function main() {
  const { config } = await import("./config/index.js");
  const { TrafficService } = await import("./services/traffic.js");
  const { WebSocketManager } = await import("./websocket/index.js");
  const { createTrafficRouter } = await import("./routes/traffic.js");

  console.log("🚀 Starting server...");

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

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

  const shutdown = async () => {
    console.log("\n👋 Shutting down...");
    await wsManager.shutdown();
    await trafficService.shutdown();
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
