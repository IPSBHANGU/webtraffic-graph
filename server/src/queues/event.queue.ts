import {  
  Queue,
  bullMQRedis,
  redisCounter,
  publishTrafficUpdate,
} from "../redis/index.js";
import { db, trafficEvents, trafficMinute } from "../db/index.js";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 100;  // Flush when batch size reached
const FLUSH_INTERVAL_MS = 300;  // Flush every 300ms for near-instant persistence

interface TrafficEvent {
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  source?: string;
  metadata?: string;
  date: string;  // YYYY-MM-DD format
}

// Helper to get date string in local timezone (YYYY-MM-DD)
function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// In-memory buffer for batching
let eventBuffer: TrafficEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isProcessingBuffer = false;

// Queue for batch database writes
export const batchQueue = new Queue("batch-db-writes", {
  connection: bullMQRedis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

// Add event to buffer and update Redis counters immediately
export async function queueTrafficEvent(event: Omit<TrafficEvent, "date">): Promise<{
  todayTotal: number;
  weekTotal: number;
}> {
  const date = getLocalDateString(event.timestamp);
  const fullEvent: TrafficEvent = { ...event, date };
  
  // Add to buffer
  eventBuffer.push(fullEvent);
  
  // Increment Redis counter IMMEDIATELY for real-time display
  const todayDate = getLocalDateString();
  const todayTotal = await redisCounter.increment(todayDate, 1);
  
  // Calculate minute key and increment minute counter
  const minuteTimestamp = new Date(
    event.timestamp.getFullYear(),
    event.timestamp.getMonth(),
    event.timestamp.getDate(),
    event.timestamp.getHours(),
    event.timestamp.getMinutes(),
    0,
    0
  );
  const minuteKey = minuteTimestamp.toISOString();
  await redisCounter.incrementMinute(minuteKey, 1);
  
  // Get week total (cached in Redis)
  const weekTotal = await redisCounter.getWeekTotal();
  
  // Publish real-time update via Redis pub/sub
  await publishTrafficUpdate({
    type: "traffic-increment",
    count: 1,
    date: todayDate,
    todayTotal,
    weekTotal,
  });
  
  // Schedule flush
  if (eventBuffer.length >= BATCH_SIZE) {
    await flushEventBuffer();
  } else if (!flushTimer && !isProcessingBuffer) {
    flushTimer = setTimeout(async () => {
      await flushEventBuffer();
    }, FLUSH_INTERVAL_MS);
  }
  
  return { todayTotal, weekTotal };
}

// Queue multiple events at once (for bulk operations)
export async function queueTrafficEvents(events: Array<Omit<TrafficEvent, "date">>): Promise<{
  todayTotal: number;
  weekTotal: number;
}> {
  if (events.length === 0) {
    return { todayTotal: 0, weekTotal: 0 };
  }
  
  const todayDate = getLocalDateString();
  
  // Group events by date and minute
  const dateIncrements = new Map<string, number>();
  const minuteIncrements = new Map<string, number>();
  
  for (const event of events) {
    const date = getLocalDateString(event.timestamp);
    const fullEvent: TrafficEvent = { ...event, date };
    eventBuffer.push(fullEvent);
    
    // Count by date
    dateIncrements.set(date, (dateIncrements.get(date) || 0) + 1);
    
    // Count by minute
    const minuteTimestamp = new Date(
      event.timestamp.getFullYear(),
      event.timestamp.getMonth(),
      event.timestamp.getDate(),
      event.timestamp.getHours(),
      event.timestamp.getMinutes(),
      0,
      0
    );
    const minuteKey = minuteTimestamp.toISOString();
    minuteIncrements.set(minuteKey, (minuteIncrements.get(minuteKey) || 0) + 1);
  }
  
  // Increment all date counters
  let todayTotal = 0;
  for (const [date, count] of dateIncrements) {
    const newTotal = await redisCounter.increment(date, count);
    if (date === todayDate) {
      todayTotal = newTotal;
    }
  }
  
  // Increment all minute counters
  for (const [minuteKey, count] of minuteIncrements) {
    await redisCounter.incrementMinute(minuteKey, count);
  }
  
  // Get week total
  const weekTotal = await redisCounter.getWeekTotal();
  
  // Publish real-time update
  await publishTrafficUpdate({
    type: "traffic-increment",
    count: events.length,
    date: todayDate,
    todayTotal,
    weekTotal,
  });
  
  // Flush if buffer is large
  if (eventBuffer.length >= BATCH_SIZE) {
    await flushEventBuffer();
  } else if (!flushTimer && !isProcessingBuffer) {
    flushTimer = setTimeout(async () => {
      await flushEventBuffer();
    }, FLUSH_INTERVAL_MS);
  }
  
  return { todayTotal, weekTotal };
}

// Flush buffer to batch queue
async function flushEventBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  
  if (eventBuffer.length === 0 || isProcessingBuffer) return;
  
  isProcessingBuffer = true;
  
  // Take all events from buffer
  const eventsToFlush = [...eventBuffer];
  eventBuffer = [];
  
  try {
    // Add batch job to queue
    await batchQueue.add("write-batch", {
      events: eventsToFlush.map((e) => ({
        timestamp: e.timestamp.toISOString(),
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        source: e.source,
        metadata: e.metadata,
        date: e.date,
      })),
      batchSize: eventsToFlush.length,
    });
    
    console.log(`📦 Queued batch of ${eventsToFlush.length} events for DB write`);
  } catch (err: any) {
    console.error("Error queueing batch:", err.message);
    // Put events back in buffer
    eventBuffer = [...eventsToFlush, ...eventBuffer];
  } finally {
    isProcessingBuffer = false;
  }
}


// Flush pending minutes from Redis to DB (for recovery/sync)
export async function syncPendingMinutes(): Promise<void> {
  const pendingMinutes = await redisCounter.getPendingMinutes();
  
  if (pendingMinutes.length === 0) return;
  
  console.log(`🔄 Syncing ${pendingMinutes.length} pending minutes to DB`);
  
  for (const minuteKey of pendingMinutes) {
    const redisCount = await redisCounter.getMinute(minuteKey);
    
    if (redisCount > 0) {
      const timestamp = new Date(minuteKey);
      try {
        await db
          .insert(trafficMinute)
          .values({ timestamp, count: redisCount, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: trafficMinute.timestamp,
            set: {
              count: redisCount,
              updatedAt: new Date(),
            },
          });
        
        await redisCounter.removePendingMinute(minuteKey);
      } catch (err: any) {
        console.error(`Error syncing minute ${minuteKey}:`, err.message);
      }
    } else {
      // Remove stale pending minute
      await redisCounter.removePendingMinute(minuteKey);
    }
  }
}

// Export buffer state for monitoring
export function getBufferSize(): number {
  return eventBuffer.length;
}

// Force flush (for graceful shutdown)
export async function forceFlush(): Promise<void> {
  await flushEventBuffer();
  await syncPendingMinutes();
}

// Graceful shutdown
export async function shutdownQueues(): Promise<void> {
  await forceFlush();
  await batchQueue.close();
  console.log("📦 Event queues shut down gracefully");
}
