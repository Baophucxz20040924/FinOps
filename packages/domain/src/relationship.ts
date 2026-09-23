import type { Confidence, IsoTimestamp } from "./common";
import type { ResourceSummary } from "./resource";

/**
 * Typed edge between two resources. Types are derived from direct AWS API
 * fields wherever possible (confidence = VERIFIED); INFERRED is reserved for
 * genuinely fuzzy, non-authoritative links and is used sparingly.
 */
export type RelationshipType =
  | "ATTACHED_TO" // EBS volume -> EC2 instance
  | "IN_SUBNET" // resource -> subnet
  | "IN_VPC" // resource -> vpc (may be denormalized via subnet)
  | "USES_SG" // resource -> security group
  | "TARGETS" // ALB/target group -> instance/task/ip
  | "MEMBER_OF" // ECS service -> cluster, subnet -> vpc
  | "ROUTES_TO" // CloudFront -> origin, NAT -> ...
  | "USES_ROLE" // resource -> IAM role/instance profile
  | "USES"; // generic fallback (parameter group, subnet group, task def)

export interface Relationship {
  id: string;
  sourceResourceId: string;
  targetResourceId: string;
  type: RelationshipType;
  confidence: Confidence;
  discoveredInScanId: string | null;
  createdAt: IsoTimestamp;
}

/** What a scanner/relationship engine emits before persistence. */
export interface NormalizedRelationship {
  sourceResourceId: string;
  targetResourceId: string;
  type: RelationshipType;
  confidence: Confidence;
}

/** Relationships of a single resource, split by direction, for the detail view. */
export interface ResourceRelationships {
  outgoing: Array<{ type: RelationshipType; target: ResourceSummary }>;
  incoming: Array<{ type: RelationshipType; source: ResourceSummary }>;
}

/** Node shape returned by GET /graph. */
export interface GraphNode {
  id: string;
  service: string;
  type: string;
  name: string | null;
  region: string;
  hasFindings: boolean;
}

/** Edge shape returned by GET /graph. */
export interface GraphEdge {
  source: string;
  target: string;
  type: RelationshipType;
  confidence: Confidence;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
