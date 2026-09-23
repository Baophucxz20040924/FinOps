CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"region" text NOT NULL,
	"arn" text,
	"external_id" text NOT NULL,
	"service" text NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"state" text,
	"environment" text,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scan_id" uuid,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_resources_natural_key" UNIQUE("account_id","region","service","external_id")
);
--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_last_scan_id_scans_id_fk" FOREIGN KEY ("last_scan_id") REFERENCES "public"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_resources_account" ON "resources" USING btree ("account_id") WHERE not "resources"."is_deleted";--> statement-breakpoint
CREATE INDEX "idx_resources_service" ON "resources" USING btree ("service");--> statement-breakpoint
CREATE INDEX "idx_resources_region" ON "resources" USING btree ("region");--> statement-breakpoint
CREATE INDEX "idx_resources_environment" ON "resources" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "idx_resources_name_trgm" ON "resources" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_resources_tags_gin" ON "resources" USING gin ("tags" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_resources_arn" ON "resources" USING btree ("arn");