import { AppError } from "@infra-explorer/shared";
import { deriveEdges } from "./derive";
import {
  getAccountIdForScan,
  loadLiveResources,
  pruneStale,
  upsertEdges,
} from "./repository";
import type { BuildResult, RelationshipEngineDeps } from "./types";

/**
 * Builds the relationship graph for the account owning `scanId`. Runs AFTER all
 * scanners have persisted their resources for the scan.
 *
 * Correctness-critical design (§G): it derives edges over the FULL LIVE ACCOUNT
 * SET, not just this scan's rows, so still-valid edges in regions/services not
 * re-scanned this round are re-affirmed to `scanId` before an account-wide prune
 * removes only genuinely-gone edges (including edges to a resource that was
 * soft-deleted this scan — see the note on §G history below).
 *
 * The empty-live-set guard skips the prune when no live resources loaded — the
 * signature of a mis-sequenced build (engine ran before resources persisted) or
 * a transient DB/load failure — so such a build cannot wipe the whole graph.
 * NOTE (known limitation, revisit when the orchestrator wires this in Phase 9):
 * the guard does NOT protect against a non-empty live set that derives zero
 * edges due to an upstream scanner regression (malformed/absent metadata) — that
 * is indistinguishable here from an account that legitimately has no
 * relationships. The durable fix is to gate the prune on the scan's OK
 * (service, region) scopes (mirroring ResourcesRepository.softDeleteAbsent),
 * which requires passing scan scope into build().
 */
export function createRelationshipEngine(deps: RelationshipEngineDeps): {
  build(scanId: string): Promise<BuildResult>;
} {
  const { db, logger } = deps;

  return {
    async build(scanId: string): Promise<BuildResult> {
      const accountId = await getAccountIdForScan(db, scanId);
      if (accountId === null) {
        throw new AppError(`Scan ${scanId} not found`, {
          status: 404,
          code: "SCAN_NOT_FOUND",
        });
      }

      const live = await loadLiveResources(db, accountId);
      const { edges, danglingRefs } = deriveEdges(live);

      const result = await db.transaction(async (tx) => {
        const edgesUpserted = await upsertEdges(tx, edges, scanId);
        if (live.length === 0) {
          logger.warn(
            { scanId, accountId },
            "Relationship build: empty live set — skipping prune to protect the graph",
          );
          return { edgesUpserted, edgesPruned: 0, pruneSkipped: true };
        }
        const edgesPruned = await pruneStale(tx, accountId, scanId);
        return { edgesUpserted, edgesPruned, pruneSkipped: false };
      });

      if (danglingRefs > 0) {
        logger.info(
          { scanId, accountId, danglingRefs },
          "Relationship build: skipped dangling references",
        );
      }

      return {
        resourcesConsidered: live.length,
        edgesUpserted: result.edgesUpserted,
        edgesPruned: result.edgesPruned,
        danglingRefs,
        pruneSkipped: result.pruneSkipped,
      };
    },
  };
}
