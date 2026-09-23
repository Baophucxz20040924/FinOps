import { sql } from "drizzle-orm";
import {
  char,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Target AWS accounts the platform can scan. Credentials are never stored here
 * — only the role ARN + generated ExternalId used for cross-account AssumeRole.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  awsAccountId: char("aws_account_id", { length: 12 }).notNull().unique(),
  displayName: text("display_name").notNull(),
  roleArn: text("role_arn").notNull(),
  externalId: text("external_id").notNull(),
  status: text("status").notNull().default("PENDING_VERIFICATION"),
  enabledRegions: text("enabled_regions")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  organizationId: uuid("organization_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
