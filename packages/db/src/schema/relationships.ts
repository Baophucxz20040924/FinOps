import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { Confidence, RelationshipType } from "@infra-explorer/domain";
import { resources } from "./resources";
import { scans } from "./scans";

/**
 * Typed edges between two resources, computed once per scan by the relationship
 * engine (§G). Both endpoints cascade-delete so an edge never outlives a
 * HARD-deleted resource; SOFT-deletes are handled by the engine's prune.
 * created_at (INSERT-only) is the true first-seen time; discovered_in_scan_id is
 * refreshed to the latest scan that re-derived the edge (the prune keys on it).
 */
export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceResourceId: uuid("source_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    targetResourceId: uuid("target_resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    type: text("type").$type<RelationshipType>().notNull(),
    confidence: text("confidence")
      .$type<Confidence>()
      .notNull()
      .default("VERIFIED"),
    discoveredInScanId: uuid("discovered_in_scan_id").references(() => scans.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_rel_source_target_type").on(
      table.sourceResourceId,
      table.targetResourceId,
      table.type,
    ),
    index("idx_rel_source").on(table.sourceResourceId),
    index("idx_rel_target").on(table.targetResourceId),
  ],
);

export type RelationshipRow = typeof relationships.$inferSelect;
export type NewRelationshipRow = typeof relationships.$inferInsert;
