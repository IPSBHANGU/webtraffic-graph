import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { TrafficService } from "../services/traffic.js";
import { subClient, REALTIME_CHANNEL } from "../redis/index.js";

interface Client extends WebSocket {
  isAlive: boolean;
  lastDataSent?: string;
}

interface RealtimeMessage {
  type: string;
  count: number;
  date: string;
  todayTotal: number;
  weekTotal: number;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private trafficService: TrafficService;
  private pingTimer: NodeJS.Timeout | null = null;
  private subscriptionReady = false;
  private messageQueue: RealtimeMessage[] = [];
  private broadcastThrottleTimer: NodeJS.Timeout | null = null;
  private lastBroadcastTime = 0;
  private minBroadcastInterval = 50; // Min 50ms between broadcasts
  private fallbackPollingTimer: NodeJS.Timeout | null = null;

  constructor(server: Server, trafficService: TrafficService) {
    this.trafficService = trafficService;
    this.wss = new WebSocketServer({ server, path: "/" });

    this.setupServer();
    this.setupRealtimeSubscription();
    this.startPingPong();
    this.startFallbackPolling();
  }

  private async setupRealtimeSubscription() {
    try {
      // Check if subClient is already subscribed
      if (this.subscriptionReady) return;

      // Wait for Redis client to be ready
      if (subClient.status !== "ready") {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            subClient.removeListener("ready", onReady);
            subClient.removeListener("error", onError);
            reject(new Error("Redis client ready timeout"));
          }, 10000); // 10 second timeout

          const onReady = () => {
            clearTimeout(timeout);
            subClient.removeListener("error", onError);
            resolve();
          };

          const onError = (err: Error) => {
            clearTimeout(timeout);
            subClient.removeListener("ready", onReady);
            reject(err);
          };

          subClient.once("ready", onReady);
          subClient.once("error", onError);
        });
      }

      // Subscribe to real-time traffic updates from Redis pub/sub
      await subClient.subscribe(REALTIME_CHANNEL);
      this.subscriptionReady = true;
      console.log(`📡 WebSocket subscribed to ${REALTIME_CHANNEL}`);

      // Handle incoming messages
      subClient.on("message", (channel: string, message: string) => {
        if (channel !== REALTIME_CHANNEL) return;

        try {
          const data = JSON.parse(message) as RealtimeMessage;
          this.handleRealtimeMessage(data);
        } catch (err: any) {
          console.error("Error parsing realtime message:", err.message);
        }
      });

      // Handle subscription errors
      subClient.on("error", (err) => {
        console.error("Redis subscription error:", err.message);
        this.subscriptionReady = false;
      });
    } catch (err: any) {
      console.error("Failed to subscribe to realtime channel:", err.message);
      this.subscriptionReady = false;
    }
  }

  private handleRealtimeMessage(data: RealtimeMessage) {
    // Queue the message
    this.messageQueue.push(data);

    // Throttle broadcasts to avoid overwhelming clients
    const now = Date.now();
    const timeSinceLastBroadcast = now - this.lastBroadcastTime;

    if (timeSinceLastBroadcast >= this.minBroadcastInterval) {
      // Broadcast immediately
      this.processBroadcastQueue();
    } else if (!this.broadcastThrottleTimer) {
      // Schedule broadcast
      const delay = this.minBroadcastInterval - timeSinceLastBroadcast;
      this.broadcastThrottleTimer = setTimeout(() => {
        this.broadcastThrottleTimer = null;
        this.processBroadcastQueue();
      }, delay);
    }
  }

  private async processBroadcastQueue() {
    if (this.messageQueue.length === 0) return;

    // Get latest message (most recent counts)
    const latestMessage = this.messageQueue[this.messageQueue.length - 1];
    this.messageQueue = [];
    this.lastBroadcastTime = Date.now();

    // Broadcast with full data
    await this.broadcastWithLiveData(latestMessage);
  }

  private async broadcastWithLiveData(realtimeData?: RealtimeMessage) {
    if (this.clients.size === 0) return;

    try {
      // Get fresh data from traffic service
      const [data, hourlyData, percentageChange] = await Promise.all([
        this.trafficService.getLast7Days(),
        this.trafficService.getHourlyData(),
        this.trafficService.getPercentageChange(),
      ]);

      // Calculate total from daily data to match the chart
      const total = data.reduce((sum, day) => sum + (day.traffic || 0), 0);

      // Use Redis count for current day if available, otherwise get from traffic service
      let currentDay: number;
      if (realtimeData) {
        currentDay = realtimeData.todayTotal;
      } else {
        currentDay = await this.trafficService.getTodayTraffic();
      }

      const message = JSON.stringify({
        type: "traffic",
        data,
        hourlyData,
        total,
        currentDay,
        percentageChange,
        timestamp: Date.now(),
        source: realtimeData ? "realtime" : "poll",
      });

      let sentCount = 0;
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          // Only send if data changed to reduce bandwidth
          if (client.lastDataSent !== message) {
            client.send(message);
            client.lastDataSent = message;
            sentCount++;
          }
        }
      }

      if (sentCount > 0 && realtimeData) {
        console.log(
          `📤 Broadcast to ${sentCount} clients: today=${currentDay}, week=${total}`
        );
      }
    } catch (err: any) {
      console.error("Broadcast error:", err.message);
    }
  }

  private setupServer() {
    this.wss.on("connection", async (ws: WebSocket) => {
      const client = ws as Client;
      client.isAlive = true;
      this.clients.add(client);

      console.log(`📱 Client connected (${this.clients.size} total)`);
      await this.sendToClient(client);

      client.on("pong", () => {
        client.isAlive = true;
      });

      client.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "getTraffic") {
            await this.sendToClient(client);
          }
        } catch {}
      });

      client.on("close", () => {
        this.clients.delete(client);
        console.log(`📱 Client disconnected (${this.clients.size} total)`);
      });

      client.on("error", () => {
        this.clients.delete(client);
      });
    });
  }

  private async sendToClient(client: Client) {
    if (client.readyState !== WebSocket.OPEN) return;

    try {
      const [data, hourlyData, currentDay, percentageChange] =
        await Promise.all([
          this.trafficService.getLast7Days(),
          this.trafficService.getHourlyData(),
          this.trafficService.getTodayTraffic(),
          this.trafficService.getPercentageChange(),
        ]);

      // Calculate total from daily data to match the chart
      const total = data.reduce((sum, day) => sum + (day.traffic || 0), 0);

      const message = JSON.stringify({
        type: "traffic",
        data,
        hourlyData,
        total,
        currentDay,
        percentageChange,
        timestamp: Date.now(),
        source: "initial",
      });

      client.send(message);
      client.lastDataSent = message;
    } catch (err: any) {
      console.error("Error sending to client:", err.message);
    }
  }

  // Fallback polling in case Redis pub/sub fails
  private startFallbackPolling() {
    this.fallbackPollingTimer = setInterval(async () => {
      // Only poll if we have clients and subscription isn't working
      if (this.clients.size > 0 && !this.subscriptionReady) {
        console.log("⚠️ Using fallback polling (Redis subscription not ready)");
        await this.broadcastWithLiveData();
      }
    }, 1000);
  }

  private startPingPong() {
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, 30000);
  }

  getClientCount() {
    return this.clients.size;
  }

  isSubscriptionActive() {
    return this.subscriptionReady;
  }

  async shutdown() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.broadcastThrottleTimer) clearTimeout(this.broadcastThrottleTimer);
    if (this.fallbackPollingTimer) clearInterval(this.fallbackPollingTimer);

    // Unsubscribe from Redis
    if (this.subscriptionReady) {
      try {
        await subClient.unsubscribe(REALTIME_CHANNEL);
      } catch (err: any) {
        console.error("Error unsubscribing:", err.message);
      }
    }

    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
  }
}
