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
import {
  queueTrafficEvent,
  queueTrafficEvents,
  getBufferSize,
  forceFlush,
  syncPendingMinutes,
} from "../queues/event.queue.js";
import { redisCounter } from "../redis/index.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export class TrafficService {
  private aggregationTimer: NodeJS.Timeout | null = null;
  private hourlyAggTimer: NodeJS.Timeout | null = null;
  private dailyAggTimer: NodeJS.Timeout | null = null;
  private weeklyAggTimer: NodeJS.Timeout | null = null;
  private monthlyAggTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  // Cache for reducing DB queries
  private cache = {
    lastUpdate: 0,
    last7Days: [] as Array<{ day: string; traffic: number; date: string }>,
    cacheDuration: 1000, // 1 second cache
  };

  constructor() {
    // Initialize Redis counters from DB
    this.initializeRedisCounters();

    // Periodic sync of pending minutes
    this.syncTimer = setInterval(() => syncPendingMinutes(), 5000);

    // Aggregation timers
    this.hourlyAggTimer = setInterval(() => this.aggregateToHour(), 60000);
    this.dailyAggTimer = setInterval(() => this.aggregateToDay(), 3600000);
    this.weeklyAggTimer = setInterval(() => this.aggregateToWeek(), 86400000);
    this.monthlyAggTimer = setInterval(() => this.aggregateToMonth(), 86400000);

    console.log(
      "📊 Traffic service started with Redis-backed real-time tracking"
    );
  }

  private async initializeRedisCounters() {
    try {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      // Initialize Redis counters for each day of the current week from DB
      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        if (date > now) break;

        const dateStr = this.formatDate(date);
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        // Get DB count for this day
        const dbResult = await db
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

        const dbCount = Number(dbResult[0]?.total) || 0;

        // Initialize Redis counter (only if Redis count is lower)
        await redisCounter.initializeFromDb(dateStr, dbCount);
      }

      const weekTotal = await redisCounter.getWeekTotal();
      const todayStr = this.formatDate(now);
      const todayTotal = await redisCounter.get(todayStr);

      console.log(
        `📊 Initialized: week total=${weekTotal.toLocaleString()}, today=${todayTotal.toLocaleString()}`
      );
    } catch (err: any) {
      console.error("Error initializing Redis counters:", err.message);
    }
  }

  async recordHit(targetDate?: Date, ipAddress?: string, userAgent?: string) {
    await this.recordHits(1, targetDate, ipAddress, userAgent);
  }

  async recordHits(
    count: number,
    targetDate?: Date,
    ipAddress?: string,
    userAgent?: string
  ) {
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

    const dateKey = this.formatDate(baseDate);

    // Queue events for batch processing (which also updates Redis counters)
    const events = Array(count)
      .fill(null)
      .map(() => ({
        timestamp: minuteTimestamp,
        ipAddress,
        userAgent,
      }));

    const { todayTotal, weekTotal } = await queueTrafficEvents(events);

    console.log(
      `📥 +${count} for ${DAY_NAMES[baseDate.getDay()]} (${dateKey} @ ${now
        .getHours()
        .toString()
        .padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}) [today: ${todayTotal}, week: ${weekTotal}]`
    );

    // Trigger aggregation check
    this.triggerAggregation(minuteTimestamp);
  }

  private triggerAggregation(minuteTimestamp: Date) {
    // Debounce aggregation
    if (this.aggregationTimer) {
      clearTimeout(this.aggregationTimer);
    }

    this.aggregationTimer = setTimeout(() => {
      this.checkAndAggregateToHour(minuteTimestamp);
    }, 2000);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Aggregate 60 minutes into 1 hour
  private async checkAndAggregateToHour(minuteTimestamp: Date) {
    const hourStart = new Date(minuteTimestamp);
    hourStart.setMinutes(0, 0, 0);

    const hourEnd = new Date(hourStart);
    hourEnd.setMinutes(59, 59, 999);

    try {
      const minuteSum = await db
        .select({
          total: sql<number>`COALESCE(SUM(${trafficMinute.count}), 0)`,
        })
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
        .select({
          total: sql<number>`COALESCE(SUM(${trafficHourly.count}), 0)`,
        })
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

    const monthStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      1,
      0,
      0,
      0,
      0
    );

    const monthEnd = new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

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
            month: monthStart.getMonth() + 1,
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
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  // Periodic aggregation functions
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

  // Get traffic for a specific date - uses Redis first, falls back to DB
  async getTrafficForDate(date: Date): Promise<number> {
    const dateKey = this.formatDate(date);
    const now = new Date();
    const todayKey = this.formatDate(now);

    // For today or recent days, use Redis (real-time)
    if (dateKey === todayKey || this.isWithinWeek(date)) {
      const redisCount = await redisCounter.get(dateKey);
      if (redisCount > 0) {
        return redisCount;
      }
    }

    // Fall back to DB
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
      // Try daily aggregate first
      const dailyResult = await db
        .select({ count: trafficDaily.count })
        .from(trafficDaily)
        .where(eq(trafficDaily.date, dayStart));

      if (dailyResult[0]?.count) {
        return dailyResult[0].count;
      }

      // Fall back to minute aggregates
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

      return Number(minuteResult[0]?.total) || 0;
    } catch {
      return 0;
    }
  }

  private isWithinWeek(date: Date): boolean {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date >= weekAgo;
  }

  async getLast7Days() {
    const now = Date.now();

    // Return cached data if fresh
    if (
      now - this.cache.lastUpdate < this.cache.cacheDuration &&
      this.cache.last7Days.length > 0
    ) {
      return this.cache.last7Days;
    }

    const result: Array<{ day: string; traffic: number; date: string }> = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - i,
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
    this.cache.lastUpdate = now;
    return result;
  }

  async getTodayTraffic(): Promise<number> {
    const todayStr = this.formatDate(new Date());
    return await redisCounter.get(todayStr);
  }

  async getTotalTraffic(): Promise<number> {
    // Get week total from Redis (real-time)
    return await redisCounter.getWeekTotal();
  }

  async getPercentageChange(): Promise<number> {
    return 0;
  }

  async getHourlyData() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );
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

  getPendingCount(): number {
    return getBufferSize();
  }

  getQueueBufferSize(): number {
    return getBufferSize();
  }

  async getCustomDateRangeData(startDate: Date, endDate: Date) {
    const result: Array<{ date: string; day: string; traffic: number }> = [];

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const current = new Date(start);
    while (current <= end) {
      const traffic = await this.getTrafficForDate(current);
      const dateStr = this.formatDate(current);

      result.push({
        date: dateStr,
        day: DAY_NAMES[current.getDay()],
        traffic,
      });

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
    if (this.aggregationTimer) clearTimeout(this.aggregationTimer);
    if (this.hourlyAggTimer) clearInterval(this.hourlyAggTimer);
    if (this.dailyAggTimer) clearInterval(this.dailyAggTimer);
    if (this.weeklyAggTimer) clearInterval(this.weeklyAggTimer);
    if (this.monthlyAggTimer) clearInterval(this.monthlyAggTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);

    await forceFlush();
    console.log("📊 Traffic service stopped");
  }
}
