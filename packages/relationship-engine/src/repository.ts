import { and, eq, sql } from "drizzle-orm";
import {
  chunk,
  type Executor,
  relationships as relationshipsT,
  resources as resourcesT,
  scans as scansT,
  type Database,
} from "@infra-explorer/db";
import type { DerivedEdge, RelResource } from "./types";

/** 5 bound params/edge → ~5k params/statement, well under Postgres' 65,535. */
const EDGE_CHUNK = 1000;

/** Resolves the owning account for a scan; null if the scan doesn't exist. */
export async function getAccountIdForScan(
  db: Database,
  scanId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ accountId: scansT.accountId })
    .from(scansT)
    .where(eq(scansT.id, scanId))
    .limit(1);
  return row?.accountId ?? null;
}

/**
 * Loads the FULL live resource set for an account (not scoped to a single scan).
 * Deriving over the full live set is what lets an account-wide edge prune be
 * safe under region-limited / partial-failure scans (see §G note).
 */
export async function loadLiveResources(
  db: Database,
  accountId: string,
): Promise<RelResource[]> {
  const rows = await db
    .select({
      id: resourcesT.id,
      accountId: resourcesT.accountId,
      region: resourcesT.region,
      service: resourcesT.service,
      type: resourcesT.type,
      externalId: resourcesT.externalId,
      metadata: resourcesT.metadata,
    })
    .from(resourcesT)
    .where(
      and(eq(resourcesT.accountId, accountId), eq(resourcesT.isDeleted, false)),
    );
  return rows;
}

/**
 * Upserts derived edges, refreshing discovered_in_scan_id (the prune key) and
 * confidence on conflict while preserving created_at (first-seen). Returns the
 * number of edge rows written.
 */
export async function upsertEdges(
  exec: Executor,
  edges: DerivedEdge[],
  scanId: string,
): Promise<number> {
  let written = 0;
  for (const batch of chunk(edges, EDGE_CHUNK)) {
    await exec
      .insert(relationshipsT)
      .values(
        batch.map((e) => ({
          sourceResourceId: e.sourceResourceId,
          targetResourceId: e.targetResourceId,
          type: e.type,
          confidence: e.confidence,
          discoveredInScanId: scanId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          relationshipsT.sourceResourceId,
          relationshipsT.targetResourceId,
          relationshipsT.type,
        ],
        set: {
          discoveredInScanId: sql`excluded.discovered_in_scan_id`,
          confidence: sql`excluded.confidence`,
          // created_at intentionally not set → true first-seen preserved
        },
      });
    written += batch.length;
  }
  return written;
}

/**
 * Deletes account edges not refreshed in this build (discovered_in_scan_id !=
 * scanId). Because derivation ran over the full live set, every still-valid edge
 * was just refreshed to scanId, so this removes only genuinely-gone edges.
 * Scoped to the account via the source endpoint.
 *
 * Scaling note (see ARCHITECTURE_PLAN §Y): the `IS DISTINCT FROM` filter + EXISTS
 * join cannot use an index as written, so this scans `relationships` per build.
 * Fine at MVP scale; when it matters, denormalize account_id onto relationships
 * and index (account_id, discovered_in_scan_id).
 */
export async function pruneStale(
  exec: Executor,
  accountId: string,
  scanId: string,
): Promise<number> {
  const deleted = await exec
    .delete(relationshipsT)
    .where(
      and(
        sql`${relationshipsT.discoveredInScanId} is distinct from ${scanId}`,
        sql`exists (select 1 from ${resourcesT} s where s.id = ${relationshipsT.sourceResourceId} and s.account_id = ${accountId})`,
      ),
    )
    .returning({ id: relationshipsT.id });
  return deleted.length;
}
