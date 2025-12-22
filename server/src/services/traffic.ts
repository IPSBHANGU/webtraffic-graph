import { eq, sql, gte, lte, and } from "drizzle-orm";
import {
  db,
  trafficEvents,
  trafficMinute,
  trafficHourly,
  trafficDaily,
  trafficWeekly,
  trafficMonthly,
} from "../db/index.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export class TrafficService {
  
  private pendingByMinute = new Map<string, number>();
  private savedByDate = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private cache = {
    lastUpdate: 0,
    last7Days: [] as Array<{ day: string; traffic: number; date: string }>,
  };
  private totalHits = 0;
  private lastNotifiedThreshold = 0;
  private readonly THRESHOLD_INTERVAL = 10000; 

  constructor() {
    this.flushTimer = setInterval(() => this.flushToDatabase(), 4000);
    // Run aggregations every minute
    setInterval(() => this.aggregateToHour(), 60000);
    // Run aggregations every hour
    setInterval(() => this.aggregateToDay(), 3600000);
    // Run aggregations every day at midnight
    setInterval(() => this.aggregateToWeek(), 86400000);
    setInterval(() => this.aggregateToMonth(), 86400000);
    // Initialize total hits from database
    this.initializeTotalHits();
    console.log("📊 Traffic service started with real-time aggregation");
  }

  private async initializeTotalHits() {
    try {
      // Get total from daily aggregation (most efficient)
      const totalResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${trafficDaily.count}), 0)` })
        .from(trafficDaily);
      
      const dbTotal = Number(totalResult[0]?.total) || 0;
      
      // Also add pending hits
      const pendingTotal = this.getPendingCount();
      
      this.totalHits = dbTotal + pendingTotal;
      
      // Set last notified threshold to the highest completed threshold
      this.lastNotifiedThreshold = Math.floor(this.totalHits / this.THRESHOLD_INTERVAL) * this.THRESHOLD_INTERVAL;
      
      console.log(`📊 Initialized total hits: ${this.totalHits.toLocaleString()} (last threshold: ${this.lastNotifiedThreshold.toLocaleString()})`);
    } catch (err: any) {
      console.error("Error initializing total hits:", err.message);
      // Continue with 0 if initialization fails
      this.totalHits = 0;
      this.lastNotifiedThreshold = 0;
    }
  }

  recordHit(targetDate?: Date, ipAddress?: string, userAgent?: string) {
    this.recordHits(1, targetDate, ipAddress, userAgent);
  }

  recordHits(count: number, targetDate?: Date, ipAddress?: string, userAgent?: string) {
    const baseDate = targetDate || new Date();
    const now = new Date();

    const minuteTimestamp = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      now.getHours(),
      now.getMinutes(),
      0,
      0
    );

    const minuteKey = minuteTimestamp.toISOString();
    const current = this.pendingByMinute.get(minuteKey) || 0;
    this.pendingByMinute.set(minuteKey, current + count);

    // Update total hits and check for threshold
    this.totalHits += count;
    this.checkAndNotifyThreshold();

    const dateKey = this.formatDate(baseDate);
    console.log(
      `📥 +${count} for ${DAY_NAMES[baseDate.getDay()]} (${dateKey} @ ${now
        .getHours()
        .toString()
        .padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")})`
    );

    
    const storeRawEvents = process.env.STORE_RAW_EVENTS === "true";
    if (storeRawEvents) {
      // Save each hit as a separate event with IP and user agent
      for (let i = 0; i < count; i++) {
        this.saveRawEvent(minuteTimestamp, ipAddress, userAgent).catch((err: any) => {
          console.error("Error saving raw event:", err.message);
        });
      }
    }
  }

  private async saveRawEvent(timestamp: Date, ipAddress?: string, userAgent?: string) {
    try {
      await db.insert(trafficEvents).values({
        timestamp,
        ipAddress,
        userAgent,
      });
    } catch (err: any) {
      console.error("DB error saving raw event:", err.message);
    }
  }

  private checkAndNotifyThreshold() {
    const currentThreshold = Math.floor(this.totalHits / this.THRESHOLD_INTERVAL) * this.THRESHOLD_INTERVAL;
    
    // Only notify if we've crossed a new threshold
    if (currentThreshold > this.lastNotifiedThreshold && currentThreshold > 0) {
      this.lastNotifiedThreshold = currentThreshold;
      this.sendThresholdNotification(currentThreshold).catch((err: any) => {
        console.error("Error sending threshold notification:", err.message);
      });
    }
  }

  private async sendThresholdNotification(threshold: number) {
    try {
      const message = `Traffic Alert: ${threshold.toLocaleString()} requests reached!\n\nTotal traffic: ${this.totalHits.toLocaleString()} requests`;
      
      const response = await fetch(`https://ntfy.sh/realtime_web_traffic`, {
        method: "POST",
        headers: {
          "Title": `Traffic Milestone: ${threshold.toLocaleString()} Requests`,
          "Priority": "4", // High priority
          "Tags": "warning,traffic"
        },
        body: message
      });

      if (!response.ok) {
        throw new Error(`Failed to send ntfy notification: ${response.statusText}`);
      }

      console.log(`🔔 Sent threshold notification for ${threshold.toLocaleString()} requests`);
    } catch (err: any) {
      console.error("Error sending threshold notification:", err.message);
    }
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private async flushToDatabase() {
    if (this.pendingByMinute.size === 0) return;

    const toFlush = new Map(this.pendingByMinute);
    this.pendingByMinute.clear();

    for (const [minuteKey, count] of toFlush) {
      if (count === 0) continue;

      const timestamp = new Date(minuteKey);
      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      const now = new Date();
      const dateKey = this.formatDate(timestamp);

      try {
        await db
          .insert(trafficMinute)
          .values({ timestamp, count, updatedAt: now })
          .onConflictDoUpdate({
            target: trafficMinute.timestamp,
            set: {
              count: sql`${trafficMinute.count} + ${count}`,
              updatedAt: now,
            },
          });

        const saved = this.savedByDate.get(dateKey) || 0;
        this.savedByDate.set(dateKey, saved + count);
        console.log(
          `💾 Saved ${count} for ${
            DAY_NAMES[timestamp.getDay()]
          } (${dateKey} @ ${timestamp
            .getHours()
            .toString()
            .padStart(2, "0")}:${timestamp
            .getMinutes()
            .toString()
            .padStart(2, "0")})`
        );

        this.cache.lastUpdate = 0;

        // Trigger hour aggregation check after saving minute data
        this.checkAndAggregateToHour(timestamp);
      } catch (err: any) {
        console.error(`DB error for ${dateKey}:`, err.message);
        const current = this.pendingByMinute.get(minuteKey) || 0;
        this.pendingByMinute.set(minuteKey, current + count);
      }
    }
  }

  // Aggregate 60 minutes into 1 hour
  private async checkAndAggregateToHour(minuteTimestamp: Date) {
    const hourStart = new Date(minuteTimestamp);
    hourStart.setMinutes(0, 0, 0);
    
    // Check if we have 60 minutes for this hour
    const hourEnd = new Date(hourStart);
    hourEnd.setMinutes(59, 59, 999);
    
    try {
      const minuteSum = await db
        .select({ total: sql<number>`COALESCE(SUM(${trafficMinute.count}), 0)` })
        .from(trafficMinute)
        .where(
          and(
            gte(trafficMinute.timestamp, hourStart),
            lte(trafficMinute.timestamp, hourEnd)
          )
        );
      
      const total = Number(minuteSum[0]?.total) || 0;
      
      if (total > 0) {
        await db
          .insert(trafficHourly)
          .values({
            timestamp: hourStart,
            count: total,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: trafficHourly.timestamp,
            set: {
              count: total,
              updatedAt: new Date(),
            },
          });
        
        // Trigger day aggregation
        this.checkAndAggregateToDay(hourStart);
      }
    } catch (err: any) {
      console.error("Error aggregating to hour:", err.message);
    }
  }

  // Aggregate 24 hours into 1 day
  private async checkAndAggregateToDay(hourTimestamp: Date) {
    const dayStart = new Date(hourTimestamp);
    dayStart.setHours(0, 0, 0, 0);
    
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    
    try {
      const hourSum = await db
        .select({ total: sql<number>`COALESCE(SUM(${trafficHourly.count}), 0)` })
        .from(trafficHourly)
        .where(
          and(
            gte(trafficHourly.timestamp, dayStart),
            lte(trafficHourly.timestamp, dayEnd)
          )
        );
      
      const total = Number(hourSum[0]?.total) || 0;
      
      if (total > 0) {
        await db
          .insert(trafficDaily)
          .values({
            date: dayStart,
            dayOfWeek: dayStart.getDay(),
            count: total,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: trafficDaily.date,
            set: {
              count: total,
              updatedAt: new Date(),
            },
          });
        
        // Trigger week and month aggregation
        this.checkAndAggregateToWeek(dayStart);
        this.checkAndAggregateToMonth(dayStart);
      }
    } catch (err: any) {
      console.error("Error aggregating to day:", err.message);
    }
  }

  // Aggregate 7 days into 1 week
  private async checkAndAggregateToWeek(dayTimestamp: Date) {
    const date = new Date(dayTimestamp);
    date.setHours(0, 0, 0, 0);
    
    // Get week start (Sunday)
    const dayOfWeek = date.getDay();
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    try {
      const daySum = await db
        .select({ total: sql<number>`COALESCE(SUM(${trafficDaily.count}), 0)` })
        .from(trafficDaily)
        .where(
          and(
            gte(trafficDaily.date, weekStart),
            lte(trafficDaily.date, weekEnd)
          )
        );
      
      const total = Number(daySum[0]?.total) || 0;
      
      if (total > 0) {
        const year = weekStart.getFullYear();
        const weekNumber = this.getWeekNumber(weekStart);
        
        // Check if week exists, then update or insert
        const existing = await db
          .select()
          .from(trafficWeekly)
          .where(
            and(
              eq(trafficWeekly.year, year),
              eq(trafficWeekly.weekNumber, weekNumber)
            )
          )
          .limit(1);
        
        if (existing.length > 0) {
          await db
            .update(trafficWeekly)
            .set({
              count: total,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(trafficWeekly.year, year),
                eq(trafficWeekly.weekNumber, weekNumber)
              )
            );
        } else {
          await db.insert(trafficWeekly).values({
            weekStart,
            weekNumber,
            year,
            count: total,
            updatedAt: new Date(),
          });
        }
      }
    } catch (err: any) {
      console.error("Error aggregating to week:", err.message);
    }
  }

  // Aggregate ~30 days into 1 month
  private async checkAndAggregateToMonth(dayTimestamp: Date) {
    const date = new Date(dayTimestamp);
    date.setHours(0, 0, 0, 0);
    
    // Get month start (first day of month)
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
    
    // Get month end (last day of month)
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    
    try {
      const daySum = await db
        .select({ total: sql<number>`COALESCE(SUM(${trafficDaily.count}), 0)` })
        .from(trafficDaily)
        .where(
          and(
            gte(trafficDaily.date, monthStart),
            lte(trafficDaily.date, monthEnd)
          )
        );
      
      const total = Number(daySum[0]?.total) || 0;
      
      if (total > 0) {
        await db
          .insert(trafficMonthly)
          .values({
            monthStart,
            year: monthStart.getFullYear(),
            month: monthStart.getMonth() + 1, // 1-12
            count: total,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: trafficMonthly.monthStart,
            set: {
              count: total,
              updatedAt: new Date(),
            },
          });
      }
    } catch (err: any) {
      console.error("Error aggregating to month:", err.message);
    }
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  // Periodic aggregation functions (backup in case real-time misses)
  private async aggregateToHour() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    oneHourAgo.setMinutes(0, 0, 0);
    await this.checkAndAggregateToHour(oneHourAgo);
  }

  private async aggregateToDay() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 86400000);
    oneDayAgo.setHours(0, 0, 0, 0);
    await this.checkAndAggregateToDay(oneDayAgo);
  }

  private async aggregateToWeek() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    await this.checkAndAggregateToWeek(now);
  }

  private async aggregateToMonth() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    await this.checkAndAggregateToMonth(now);
  }

  private getPendingForDate(dateKey: string): number {
    // Sum all pending minute windows that fall on this date
    let total = 0;
    for (const [minuteKey, count] of this.pendingByMinute.entries()) {
      const ts = new Date(minuteKey);
      if (!Number.isNaN(ts.getTime()) && this.formatDate(ts) === dateKey) {
        total += count;
      }
    }
    return total;
  }

  async getTrafficForDate(date: Date): Promise<number> {
    const dateKey = this.formatDate(date);
    const dayStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0
    );
    const dayEnd = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59
    );

    try {
      const dailyResult = await db
        .select({ count: trafficDaily.count })
        .from(trafficDaily)
        .where(eq(trafficDaily.date, dayStart));

      if (dailyResult[0]?.count) {
        return dailyResult[0].count + this.getPendingForDate(dateKey);
      }

      const minuteResult = await db
        .select({
          total: sql<number>`COALESCE(SUM(${trafficMinute.count}), 0)`,
        })
        .from(trafficMinute)
        .where(
          and(
            gte(trafficMinute.timestamp, dayStart),
            lte(trafficMinute.timestamp, dayEnd)
          )
        );

      return (
        (Number(minuteResult[0]?.total) || 0) + this.getPendingForDate(dateKey)
      );
    } catch {
      return this.getPendingForDate(dateKey);
    }
  }

  async getLast7Days() {
    const now = new Date();
    const result: Array<{ day: string; traffic: number; date: string }> = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - i,
        12,
        0,
        0
      );
      const traffic = await this.getTrafficForDate(date);

      result.push({
        day: DAY_NAMES[date.getDay()],
        traffic,
        date: this.formatDate(date),
      });
    }

    this.cache.last7Days = result;
    this.cache.lastUpdate = Date.now();
    return result;
  }

  async getTodayTraffic() {
    return this.getTrafficForDate(new Date());
  }

  async getTotalTraffic() {
    const days = await this.getLast7Days();
    return days.reduce((sum, d) => sum + d.traffic, 0);
  }

  async getPercentageChange() {
    return 0;
  }

  async getHourlyData() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const result: Array<{ hour: number; label: string; traffic: number }> = [];

    try {
      const hourlyData = await db
        .select()
        .from(trafficHourly)
        .where(
          and(
            gte(trafficHourly.timestamp, todayStart),
            lte(trafficHourly.timestamp, now)
          )
        )
        .orderBy(trafficHourly.timestamp);

      const hourlyMap = new Map<number, number>();
      hourlyData.forEach((h) => {
        const hour = h.timestamp.getHours();
        hourlyMap.set(hour, h.count);
      });

      for (let h = 0; h <= now.getHours(); h++) {
        result.push({
          hour: h,
          label: `${h.toString().padStart(2, "0")}:00`,
          traffic: hourlyMap.get(h) || 0,
        });
      }
    } catch (err) {
      console.error("Error fetching hourly data:", err);
      for (let h = 0; h <= now.getHours(); h++) {
        result.push({
          hour: h,
          label: `${h.toString().padStart(2, "0")}:00`,
          traffic: 0,
        });
      }
    }
    return result;
  }

  async getWeeklyData() {
    const now = new Date();
    const sixWeeksAgo = new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000);
    
    try {
      const weeklyData = await db
        .select()
        .from(trafficWeekly)
        .where(gte(trafficWeekly.weekStart, sixWeeksAgo))
        .orderBy(trafficWeekly.weekStart);
      
      return weeklyData.map((w) => ({
        weekStart: w.weekStart.toISOString().split("T")[0],
        weekNumber: w.weekNumber,
        year: w.year,
        count: w.count,
      }));
    } catch (err) {
      console.error("Error fetching weekly data:", err);
      return [];
    }
  }

  async getMonthlyData() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    
    try {
      const monthlyData = await db
        .select()
        .from(trafficMonthly)
        .where(gte(trafficMonthly.monthStart, sixMonthsAgo))
        .orderBy(trafficMonthly.monthStart);
      
      return monthlyData.map((m) => ({
        monthStart: m.monthStart.toISOString().split("T")[0],
        year: m.year,
        month: m.month,
        count: m.count,
      }));
    } catch (err) {
      console.error("Error fetching monthly data:", err);
      return [];
    }
  }

  getPendingCount() {
    let total = 0;
    for (const count of this.pendingByMinute.values()) {
      total += count;
    }
    return total;
  }

  async getCustomDateRangeData(startDate: Date, endDate: Date) {
    const result: Array<{ date: string; day: string; traffic: number }> = [];
    
    // Normalize dates
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    // Get all days in the range
    const current = new Date(start);
    while (current <= end) {
      const traffic = await this.getTrafficForDate(current);
      const dateStr = this.formatDate(current);
      
      result.push({
        date: dateStr,
        day: DAY_NAMES[current.getDay()],
        traffic,
      });
      
      // Move to next day
      current.setDate(current.getDate() + 1);
    }
    
    return result;
  }

  async getMultipleDatesData(dates: Date[]) {
    const result: Array<{ date: string; day: string; traffic: number }> = [];
    
    for (const date of dates) {
      const normalized = new Date(date);
      normalized.setHours(0, 0, 0, 0);
      
      const traffic = await this.getTrafficForDate(normalized);
      const dateStr = this.formatDate(normalized);
      
      result.push({
        date: dateStr,
        day: DAY_NAMES[normalized.getDay()],
        traffic,
      });
    }
    
    // Sort by date
    result.sort((a, b) => a.date.localeCompare(b.date));
    
    return result;
  }

  async *getAllEventsStream(startDate?: Date, endDate?: Date) {
    try {
      const conditions: any[] = [];
      if (startDate) {
        conditions.push(gte(trafficEvents.timestamp, startDate));
      }
      if (endDate) {
        conditions.push(lte(trafficEvents.timestamp, endDate));
      }
      
      let query = db.select().from(trafficEvents);
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const events = await query.orderBy(trafficEvents.timestamp);
      
      for (const event of events) {
        yield event;
      }
    } catch (err: any) {
      console.error("Error streaming events:", err.message);
      throw err;
    }
  }

  async getAllEvents(startDate?: Date, endDate?: Date) {
    try {
      const conditions: any[] = [];
      if (startDate) {
        conditions.push(gte(trafficEvents.timestamp, startDate));
      }
      if (endDate) {
        conditions.push(lte(trafficEvents.timestamp, endDate));
      }
      
      let query = db.select().from(trafficEvents);
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      return await query.orderBy(trafficEvents.timestamp);
    } catch (err: any) {
      console.error("Error fetching events:", err.message);
      throw err;
    }
  }

  async shutdown() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushToDatabase();
    console.log("📊 Traffic service stopped");
  }
}
