CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_resource_id" uuid NOT NULL,
	"target_resource_id" uuid NOT NULL,
	"type" text NOT NULL,
	"confidence" text DEFAULT 'VERIFIED' NOT NULL,
	"discovered_in_scan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rel_source_target_type" UNIQUE("source_resource_id","target_resource_id","type")
);
--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_resource_id_resources_id_fk" FOREIGN KEY ("source_resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_target_resource_id_resources_id_fk" FOREIGN KEY ("target_resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_discovered_in_scan_id_scans_id_fk" FOREIGN KEY ("discovered_in_scan_id") REFERENCES "public"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_rel_source" ON "relationships" USING btree ("source_resource_id");--> statement-breakpoint
CREATE INDEX "idx_rel_target" ON "relationships" USING btree ("target_resource_id");