CREATE TABLE IF NOT EXISTS "traffic_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_start" timestamp with time zone NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_monthly_month_start_unique" UNIQUE("month_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_monthly_month_start_idx" ON "traffic_monthly" USING btree ("month_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_monthly_year_month_idx" ON "traffic_monthly" USING btree ("year","month");