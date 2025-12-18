CREATE TABLE IF NOT EXISTS "traffic_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"day_of_week" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_daily_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(255),
	"metadata" varchar(1000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_hourly" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_hourly_timestamp_unique" UNIQUE("timestamp")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_minute" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_minute_timestamp_unique" UNIQUE("timestamp")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_realtime" (
	"id" serial PRIMARY KEY NOT NULL,
	"current_minute" timestamp with time zone NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_realtime_current_minute_unique" UNIQUE("current_minute")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_weekly" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"week_number" integer NOT NULL,
	"year" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_weekly_year_week_unique" UNIQUE("year","week_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_daily_date_idx" ON "traffic_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_daily_day_of_week_idx" ON "traffic_daily" USING btree ("day_of_week");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_events_timestamp_idx" ON "traffic_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_hourly_timestamp_idx" ON "traffic_hourly" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_minute_timestamp_idx" ON "traffic_minute" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_realtime_current_minute_idx" ON "traffic_realtime" USING btree ("current_minute");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_weekly_week_start_idx" ON "traffic_weekly" USING btree ("week_start");