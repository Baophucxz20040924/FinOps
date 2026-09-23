import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ResourceMetadata, Tags } from "@infra-explorer/domain";
import { accounts } from "./accounts";
import { scans } from "./scans";

/**
 * The core resource inventory — every discovered AWS resource, all types, in one
 * table (§E). Common columns are promoted; service-specific fields live in
 * `metadata` (jsonb). Rows are idempotent by the natural key
 * (account_id, region, service, external_id); resources absent from a later
 * SUCCESSFUL scan of the same (service, region) scope are soft-deleted
 * (is_deleted=true), never hard-deleted, so they resurrect in place if seen
 * again (same id + first_seen_at).
 */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    region: text("region").notNull(), // real region, or "global" (GLOBAL_REGION)
    arn: text("arn"), // nullable — some sub-objects are ARN-less
    externalId: text("external_id").notNull(), // native AWS id (i-*, vol-*, vpc-*, …)
    service: text("service").notNull(),
    type: text("type").notNull(),
    name: text("name"),
    state: text("state"),
    environment: text("environment"),
    tags: jsonb("tags").$type<Tags>().notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb("metadata")
      .$type<ResourceMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastScanId: uuid("last_scan_id").references(() => scans.id),
    isDeleted: boolean("is_deleted").notNull().default(false),
  },
  (table) => [
    unique("uq_resources_natural_key").on(
      table.accountId,
      table.region,
      table.service,
      table.externalId,
    ),
    index("idx_resources_account")
      .on(table.accountId)
      .where(sql`not ${table.isDeleted}`),
    index("idx_resources_service").on(table.service),
    index("idx_resources_region").on(table.region),
    index("idx_resources_environment").on(table.environment),
    index("idx_resources_name_trgm").using(
      "gin",
      table.name.op("gin_trgm_ops"),
    ),
    index("idx_resources_tags_gin").using(
      "gin",
      table.tags.op("jsonb_path_ops"),
    ),
    index("idx_resources_arn").on(table.arn),
  ],
);

export type ResourceRow = typeof resources.$inferSelect;
export type NewResourceRow = typeof resources.$inferInsert;
