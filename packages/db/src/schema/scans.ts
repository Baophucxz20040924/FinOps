import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ScanStats, ServiceResult } from "@infra-explorer/domain";
import { accounts } from "./accounts";

/** One execution of the scan pipeline against an account + set of regions. */
export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    regions: text("regions").array().notNull(),
    status: text("status").notNull().default("QUEUED"),
    triggeredBy: text("triggered_by").notNull(),
    serviceResults: jsonb("service_results")
      .$type<ServiceResult[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    stats: jsonb("stats")
      .$type<Partial<ScanStats>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_scans_account_created").on(
      table.accountId,
      table.createdAt.desc(),
    ),
  ],
);

export type ScanRow = typeof scans.$inferSelect;
export type NewScanRow = typeof scans.$inferInsert;
