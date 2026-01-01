import { Redis } from "ioredis";
import dotenv from "dotenv";
import { Queue, Worker, Job } from "bullmq";
dotenv.config();

// Create Redis client from URL (works with Upstash)
function createRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    // Local development fallback
    return new Redis({
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
    });
  }

  // Upstash or other Redis URL (supports rediss:// for TLS)
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    enableReadyCheck: true,
    // Upstash requires TLS, which is auto-detected from rediss:// URL
  });
}

// Create Redis clients
const bullMQRedis: Redis = createRedisClient();
const pubClient: Redis = createRedisClient();
const subClient: Redis = createRedisClient();
const counterClient: Redis = createRedisClient(); // Dedicated client for atomic counter operations

// Connection logging
const clients = [
  { name: "bullMQ", client: bullMQRedis },
  { name: "pub", client: pubClient },
  { name: "sub", client: subClient },
  { name: "counter", client: counterClient },
];

clients.forEach(({ name, client }) => {
  client.on("connect", () =>
    console.log(`🔗 Redis ${name} client connecting...`)
  );
  client.on("ready", () => console.log(`✅ Redis ${name} client ready`));
  client.on("error", (err) =>
    console.error(`❌ Redis ${name} error:`, err.message)
  );
  client.on("close", () => console.log(`⚠️ Redis ${name} client closed`));
  client.on("reconnecting", () =>
    console.log(`🔄 Redis ${name} client reconnecting...`)
  );
});

// Channel for real-time traffic updates
export const REALTIME_CHANNEL = "traffic:realtime";

// Helper to get date string in local timezone (YYYY-MM-DD)
function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Redis keys for atomic counters
export const REDIS_KEYS = {
  // Counter for today's traffic (resets daily)
  todayCounter: () => `traffic:counter:${getLocalDateString()}`,
  // Counter for current week
  weekCounter: () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    return `traffic:counter:week:${getLocalDateString(startOfWeek)}`;
  },
  // Counter for specific date
  dateCounter: (date: string) => `traffic:counter:${date}`,
  // Counter for current minute (for batching)
  minuteCounter: (minuteKey: string) => `traffic:minute:${minuteKey}`,
  // Set of minutes that need to be flushed to DB
  pendingMinutes: "traffic:pending_minutes",
  // Last synced DB count for consistency
  lastSyncedTotal: "traffic:last_synced_total",
  // Increment counter for session (monotonic)
  sessionIncrements: "traffic:session_increments",
};

// Atomic counter operations
export const redisCounter = {
  // Increment counter for a date and return new value
  async increment(date: string, amount: number = 1): Promise<number> {
    const key = REDIS_KEYS.dateCounter(date);
    const result = await counterClient.incrby(key, amount);
    // Set expiry to 8 days
    await counterClient.expire(key, 8 * 24 * 60 * 60);
    return result;
  },

  // Get counter for a date
  async get(date: string): Promise<number> {
    const key = REDIS_KEYS.dateCounter(date);
    const result = await counterClient.get(key);
    return parseInt(result || "0", 10);
  },

  // Increment minute counter
  async incrementMinute(
    minuteKey: string,
    amount: number = 1
  ): Promise<number> {
    const key = REDIS_KEYS.minuteCounter(minuteKey);
    const result = await counterClient.incrby(key, amount);
    // Add to pending minutes set
    await counterClient.sadd(REDIS_KEYS.pendingMinutes, minuteKey);
    // Set expiry to 2 hours
    await counterClient.expire(key, 2 * 60 * 60);
    return result;
  },

  // Get minute counter
  async getMinute(minuteKey: string): Promise<number> {
    const key = REDIS_KEYS.minuteCounter(minuteKey);
    const result = await counterClient.get(key);
    return parseInt(result || "0", 10);
  },

  // Get all pending minutes
  async getPendingMinutes(): Promise<string[]> {
    return await counterClient.smembers(REDIS_KEYS.pendingMinutes);
  },

  // Remove minute from pending set
  async removePendingMinute(minuteKey: string): Promise<void> {
    await counterClient.srem(REDIS_KEYS.pendingMinutes, minuteKey);
  },

  // Get week total from Redis counters
  async getWeekTotal(): Promise<number> {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    let total = 0;
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      if (date > now) break;

      // Use local date string for consistency
      const dateStr = getLocalDateString(date);
      total += await this.get(dateStr);
    }
    return total;
  },

  // Initialize Redis counter from DB value
  async initializeFromDb(date: string, dbValue: number): Promise<void> {
    const key = REDIS_KEYS.dateCounter(date);
    const currentValue = await counterClient.get(key);

    // Only set if Redis value is lower than DB
    if (!currentValue || parseInt(currentValue, 10) < dbValue) {
      await counterClient.set(key, dbValue.toString());
      await counterClient.expire(key, 8 * 24 * 60 * 60);
    }
  },

  // Sync Redis counter from DB value (always use DB as source of truth)
  async syncFromDb(date: string, dbValue: number): Promise<void> {
    const key = REDIS_KEYS.dateCounter(date);
    const currentValue = await counterClient.get(key);
    const currentNum = parseInt(currentValue || "0", 10);

    // Always update if DB value is different (DB is source of truth for sync)
    if (currentNum !== dbValue) {
      await counterClient.set(key, dbValue.toString());
      await counterClient.expire(key, 8 * 24 * 60 * 60);
    }
  },

  // Get session increment count (monotonic)
  async getSessionIncrements(): Promise<number> {
    const result = await counterClient.get(REDIS_KEYS.sessionIncrements);
    return parseInt(result || "0", 10);
  },

  // Increment session counter
  async incrementSession(amount: number = 1): Promise<number> {
    return await counterClient.incrby(REDIS_KEYS.sessionIncrements, amount);
  },
};

// Publish real-time update
export async function publishTrafficUpdate(data: {
  type: string;
  count: number;
  date: string;
  todayTotal: number;
  weekTotal: number;
}): Promise<void> {
  try {
    await pubClient.publish(REALTIME_CHANNEL, JSON.stringify(data));
  } catch (err: any) {
    console.error("Failed to publish traffic update:", err.message);
  }
}

// Graceful shutdown
export async function shutdownRedis(): Promise<void> {
  console.log("🔌 Shutting down Redis connections...");
  await Promise.all([
    bullMQRedis.quit(),
    pubClient.quit(),
    subClient.quit(),
    counterClient.quit(),
  ]);
  console.log("✅ Redis connections closed");
}

export { bullMQRedis, pubClient, subClient, counterClient, Queue, Worker, Job };
