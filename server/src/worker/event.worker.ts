import "../env.js";
import {
    Job,
    Worker,
    bullMQRedis,
    redisCounter,
  } from "../redis/index.js";
  import { db, trafficEvents, trafficMinute } from "../db/index.js";

console.log("🔧 Starting worker...");

const batchWorker = new Worker(
    "batch-db-writes",
    async (job: Job) => {
      const { events } = job.data;
      
      console.log(`💾 Processing batch of ${events.length} events`);
      
      // Aggregate events by minute for trafficMinute table
      const minuteAggregates = new Map<string, number>();
      for (const event of events) {
        const timestamp = new Date(event.timestamp);
        const minuteTimestamp = new Date(
          timestamp.getFullYear(),
          timestamp.getMonth(),
          timestamp.getDate(),
          timestamp.getHours(),
          timestamp.getMinutes(),
          0,
          0
        );
        const minuteKey = minuteTimestamp.toISOString();
        minuteAggregates.set(
          minuteKey,
          (minuteAggregates.get(minuteKey) || 0) + 1
        );
      }
      
      // Get Redis minute counts and sync to DB
      // This ensures we only write what's in Redis (authoritative)
      for (const [minuteKey, _count] of minuteAggregates) {
        const redisCount = await redisCounter.getMinute(minuteKey);
        
        if (redisCount > 0) {
          const timestamp = new Date(minuteKey);
          try {
            // Upsert to DB - use Redis count as authoritative
            await db
              .insert(trafficMinute)
              .values({ timestamp, count: redisCount, updatedAt: new Date() })
              .onConflictDoUpdate({
                target: trafficMinute.timestamp,
                set: {
                  count: redisCount, // Use Redis count directly (it's authoritative)
                  updatedAt: new Date(),
                },
              });
            
            // Remove from pending minutes after successful write
            await redisCounter.removePendingMinute(minuteKey);
          } catch (err: any) {
            console.error(
              `Error upserting minute aggregate for ${minuteKey}:`,
              err.message
            );
          }
        }
      }
      
      // Insert raw events if STORE_RAW_EVENTS is enabled
      const storeRawEvents = process.env.STORE_RAW_EVENTS === "true";
      if (storeRawEvents && events.length > 0) {
        try {
          await db.insert(trafficEvents).values(
            events.map((e: any) => ({
              timestamp: new Date(e.timestamp),
              ipAddress: e.ipAddress,
              userAgent: e.userAgent,
              source: e.source,
              metadata: e.metadata,
            }))
          );
        } catch (err: any) {
          console.error("Error batch inserting raw events:", err.message);
          // Don't throw - minute aggregates are more important
        }
      }
      
      return {
        processed: events.length,
        minuteAggregates: minuteAggregates.size,
        rawEventsStored: storeRawEvents ? events.length : 0,
      };
    },
    {
      connection: bullMQRedis,
      concurrency: 1,  // Process batches sequentially to avoid race conditions
      lockDuration: 60_000,
    }
  );
  
  batchWorker.on("completed", async (job: Job, result) => {
    console.log(
      `✅ Batch job ${job.id} completed: ${result.processed} events, ${result.minuteAggregates} minute aggregates${
        result.rawEventsStored > 0 ? `, ${result.rawEventsStored} raw events stored` : ""
      }`
    );
  });
  
  batchWorker.on("failed", async (job: Job | undefined, error) => {
    console.error(`❌ Batch job ${job?.id} failed:`, error);
  });

batchWorker.on("ready", () => {
  console.log("✅ Worker ready and listening for jobs");
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\n👋 Shutting down worker...");
  await batchWorker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("✅ Worker started successfully");