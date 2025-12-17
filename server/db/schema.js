import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const dailyTraffic = pgTable('daily_traffic', {
  date: text('date').primaryKey(),
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const hourlyTraffic = pgTable('hourly_traffic', {
  key: text('key').primaryKey(), // Format: YYYY-MM-DD-HH
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const minuteTraffic = pgTable('minute_traffic', {
  key: text('key').primaryKey(), // Format: YYYY-MM-DD-HH-MM
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

