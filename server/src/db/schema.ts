import {
  pgTable,
  serial,
  integer,
  timestamp,
  varchar,
  index,
  bigint,
  unique,
} from "drizzle-orm/pg-core";

export const trafficEvents = pgTable(
  "traffic_events",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .defaultNow()
      .notNull(),
    source: varchar("source", { length: 255 }),
    metadata: varchar("metadata", { length: 1000 }),
  },
  (table) => ({
    timestampIdx: index("traffic_events_timestamp_idx").on(table.timestamp),
  })
);

export const trafficMinute = pgTable(
  "traffic_minute",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .unique(),
    count: integer("count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    timestampIdx: index("traffic_minute_timestamp_idx").on(table.timestamp),
  })
);

export const trafficHourly = pgTable(
  "traffic_hourly",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .unique(),
    count: integer("count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    timestampIdx: index("traffic_hourly_timestamp_idx").on(table.timestamp),
  })
);

export const trafficDaily = pgTable(
  "traffic_daily",
  {
    id: serial("id").primaryKey(),
    date: timestamp("date", { withTimezone: true }).notNull().unique(),
    dayOfWeek: integer("day_of_week").notNull(),
    count: integer("count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    dateIdx: index("traffic_daily_date_idx").on(table.date),
    dayOfWeekIdx: index("traffic_daily_day_of_week_idx").on(table.dayOfWeek),
  })
);

export const trafficWeekly = pgTable(
  "traffic_weekly",
  {
    id: serial("id").primaryKey(),
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
    weekNumber: integer("week_number").notNull(),
    year: integer("year").notNull(),
    count: integer("count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    weekStartIdx: index("traffic_weekly_week_start_idx").on(table.weekStart),
    yearWeekUnique: unique("traffic_weekly_year_week_unique").on(
      table.year,
      table.weekNumber
    ),
  })
);

export const trafficRealtime = pgTable(
  "traffic_realtime",
  {
    id: serial("id").primaryKey(),
    currentMinute: timestamp("current_minute", { withTimezone: true })
      .notNull()
      .unique(),
    count: bigint("count", { mode: "number" }).default(0).notNull(),
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    currentMinuteIdx: index("traffic_realtime_current_minute_idx").on(
      table.currentMinute
    ),
  })
);

export type TrafficEvent = typeof trafficEvents.$inferSelect;
export type NewTrafficEvent = typeof trafficEvents.$inferInsert;
export type TrafficMinute = typeof trafficMinute.$inferSelect;
export type NewTrafficMinute = typeof trafficMinute.$inferInsert;
export type TrafficHourly = typeof trafficHourly.$inferSelect;
export type NewTrafficHourly = typeof trafficHourly.$inferInsert;
export type TrafficDaily = typeof trafficDaily.$inferSelect;
export type NewTrafficDaily = typeof trafficDaily.$inferInsert;
export type TrafficWeekly = typeof trafficWeekly.$inferSelect;
export type NewTrafficWeekly = typeof trafficWeekly.$inferInsert;
export type TrafficRealtime = typeof trafficRealtime.$inferSelect;
export type NewTrafficRealtime = typeof trafficRealtime.$inferInsert;
