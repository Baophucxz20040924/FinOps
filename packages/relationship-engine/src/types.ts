import type {
  Confidence,
  RelationshipType,
  ResourceMetadata,
} from "@infra-explorer/domain";
import type { Database } from "@infra-explorer/db";
import type { Logger } from "@infra-explorer/shared";

/** The slice of a resource the engine needs to derive edges. */
export interface RelResource {
  id: string;
  accountId: string;
  region: string;
  service: string;
  type: string;
  externalId: string;
  metadata: ResourceMetadata;
}

/** An edge produced by pure derivation, before persistence. */
export interface DerivedEdge {
  sourceResourceId: string;
  targetResourceId: string;
  type: RelationshipType;
  confidence: Confidence;
}

export interface DeriveResult {
  edges: DerivedEdge[];
  /** References whose target wasn't found in the live set (skipped, not fatal). */
  danglingRefs: number;
}

export interface BuildResult {
  resourcesConsidered: number;
  edgesUpserted: number;
  edgesPruned: number;
  danglingRefs: number;
  /** True when the prune was skipped because the live set was empty. */
  pruneSkipped: boolean;
}

export interface RelationshipEngineDeps {
  db: Database;
  logger: Logger;
}
