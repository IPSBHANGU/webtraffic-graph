import { eq, sql, gte, lte, and } from "drizzle-orm";
import { db, trafficMinute, trafficDaily } from "../db/index.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export class TrafficService {
  private pendingByDate = new Map<string, number>();
  private savedByDate = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private cache = {
    lastUpdate: 0,
    last7Days: [] as Array<{ day: string; traffic: number; date: string }>,
  };

  constructor() {
    this.flushTimer = setInterval(() => this.flushToDatabase(), 4000);
    console.log("📊 Traffic service started");
  }

  recordHit(targetDate?: Date) {
    this.recordHits(1, targetDate);
  }

  recordHits(count: number, targetDate?: Date) {
    const date = targetDate || new Date();
    const dateKey = this.formatDate(date);
    const current = this.pendingByDate.get(dateKey) || 0;
    this.pendingByDate.set(dateKey, current + count);

    console.log(`📥 +${count} for ${DAY_NAMES[date.getDay()]} (${dateKey})`);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private async flushToDatabase() {
    if (this.pendingByDate.size === 0) return;

    const toFlush = new Map(this.pendingByDate);
    this.pendingByDate.clear();

    for (const [dateKey, count] of toFlush) {
      if (count === 0) continue;

      const [year, month, day] = dateKey.split("-").map(Number);
      const targetDate = new Date(year, month - 1, day, 12, 0, 0);
      const now = new Date();

      const timestamp = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
        now.getHours(),
        now.getMinutes(),
        0,
        0
      );

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
          `💾 Saved ${count} for ${DAY_NAMES[targetDate.getDay()]} (${dateKey})`
        );

        this.cache.lastUpdate = 0;
      } catch (err: any) {
        console.error(`DB error for ${dateKey}:`, err.message);
        const current = this.pendingByDate.get(dateKey) || 0;
        this.pendingByDate.set(dateKey, current + count);
      }
    }
  }

  private getPendingForDate(dateKey: string): number {
    return this.pendingByDate.get(dateKey) || 0;
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
    const result: Array<{ hour: number; label: string; traffic: number }> = [];

    for (let h = 0; h <= now.getHours(); h++) {
      result.push({
        hour: h,
        label: `${h.toString().padStart(2, "0")}:00`,
        traffic: 0,
      });
    }
    return result;
  }

  getPendingCount() {
    let total = 0;
    for (const count of this.pendingByDate.values()) {
      total += count;
    }
    return total;
  }

  async shutdown() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushToDatabase();
    console.log("📊 Traffic service stopped");
  }
}
