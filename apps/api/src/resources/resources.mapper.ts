import type {
  GraphNode,
  Resource,
  ResourceSummary,
} from "@infra-explorer/domain";
import type { ResourceRow } from "@infra-explorer/db";

/** Maps a persisted resource row to the full normalized domain shape. */
export function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    arn: row.arn,
    externalId: row.externalId,
    accountId: row.accountId,
    region: row.region,
    service: row.service,
    type: row.type,
    name: row.name,
    state: row.state,
    environment: row.environment,
    tags: row.tags,
    metadata: row.metadata,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastScanId: row.lastScanId,
    isDeleted: row.isDeleted,
  };
}

/** Compact row for the Resource Explorer table. Cost/findings filled by caller. */
export function toResourceSummary(
  row: ResourceRow,
  extras: { estimatedMonthlyCost: number | null; findingsCount: number },
): ResourceSummary {
  return {
    id: row.id,
    service: row.service,
    type: row.type,
    name: row.name,
    state: row.state,
    region: row.region,
    environment: row.environment,
    estimatedMonthlyCost: extras.estimatedMonthlyCost,
    findingsCount: extras.findingsCount,
  };
}

/** Graph node shape for React Flow. */
export function toGraphNode(
  row: ResourceRow,
  hasFindings: boolean,
): GraphNode {
  return {
    id: row.id,
    service: row.service,
    type: row.type,
    name: row.name,
    region: row.region,
    hasFindings,
  };
}
