CREATE TYPE "public"."onboarding_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" "onboarding_status" DEFAULT 'in_progress' NOT NULL,
	"full_name" text,
	"date_of_birth" date,
	"phone" text,
	"city" text,
	"state" text,
	"occupation" text,
	"experience_level" text,
	"instruments_traded" jsonb,
	"trading_style" text,
	"trading_goals" jsonb,
	"risk_appetite" text,
	"starting_capital" numeric(24, 8),
	"watchlist" jsonb,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"risk_disclosure_accepted_at" timestamp with time zone,
	"acceptance_ip_address" text,
	"acceptance_user_agent" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_onboarding_status_idx" ON "user_onboarding" USING btree ("status");