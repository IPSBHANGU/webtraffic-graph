import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { TrafficService } from "../services/traffic.js";

interface Client extends WebSocket {
  isAlive: boolean;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private trafficService: TrafficService;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(server: Server, trafficService: TrafficService) {
    this.trafficService = trafficService;
    this.wss = new WebSocketServer({ server, path: "/" });

    this.setupServer();
    this.startBroadcasting();
    this.startPingPong();
  }

  private setupServer() {
    this.wss.on("connection", (ws: WebSocket) => {
      const client = ws as Client;
      client.isAlive = true;
      this.clients.add(client);

      console.log(`📱 Client connected (${this.clients.size} total)`);
      this.sendToClient(client);

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
      const [data, hourlyData, total, currentDay, percentageChange] =
        await Promise.all([
          this.trafficService.getLast7Days(),
          this.trafficService.getHourlyData(),
          this.trafficService.getTotalTraffic(),
          this.trafficService.getTodayTraffic(),
          this.trafficService.getPercentageChange(),
        ]);

      client.send(
        JSON.stringify({
          type: "traffic",
          data,
          hourlyData,
          total,
          currentDay,
          percentageChange,
          timestamp: Date.now(),
        })
      );
    } catch (err) {
      console.error("Error sending to client:", err);
    }
  }

  private async broadcast() {
    if (this.clients.size === 0) return;

    try {
      const [data, hourlyData, total, currentDay, percentageChange] =
        await Promise.all([
          this.trafficService.getLast7Days(),
          this.trafficService.getHourlyData(),
          this.trafficService.getTotalTraffic(),
          this.trafficService.getTodayTraffic(),
          this.trafficService.getPercentageChange(),
        ]);

      const message = JSON.stringify({
        type: "traffic",
        data,
        hourlyData,
        total,
        currentDay,
        percentageChange,
        timestamp: Date.now(),
      });

      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    } catch (err) {
      console.error("Broadcast error:", err);
    }
  }

  private startBroadcasting() {
    this.broadcastTimer = setInterval(() => this.broadcast(), 500);
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

  async shutdown() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);

    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
  }
}
