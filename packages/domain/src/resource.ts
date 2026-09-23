import type { IsoTimestamp, ServiceName } from "./common";

/** Free-form tag map copied from AWS resource tags. */
export type Tags = Record<string, string>;

/**
 * Service-specific fields live here (jsonb in the DB). Only fields we filter or
 * sort on constantly are promoted to top-level columns (state, environment).
 */
export type ResourceMetadata = Record<string, unknown>;

/**
 * The normalized, service-agnostic shape of every discovered AWS resource.
 * Raw AWS SDK responses are never exposed to the frontend — everything is
 * mapped into this model by a per-service normalizer.
 */
export interface Resource {
  /** Internal uuid. */
  id: string;
  /** AWS ARN; null for a few ARN-less sub-objects. */
  arn: string | null;
  /** Native AWS id, e.g. "i-0123", "vol-0123", bucket name. */
  externalId: string;
  accountId: string;
  /** Region code, or "global" for global resources. */
  region: string;
  service: ServiceName | string;
  /** Finer-grained than service, e.g. "instance", "volume", "subnet". */
  type: string;
  /** Derived from tags.Name, falling back to externalId. */
  name: string | null;
  /** Normalized per-type state, e.g. "running", "available", "unattached". */
  state: string | null;
  /** Best-effort environment from tags (Environment/env/stage). */
  environment: string | null;
  tags: Tags;
  metadata: ResourceMetadata;
  firstSeenAt: IsoTimestamp;
  lastSeenAt: IsoTimestamp;
  lastScanId: string | null;
  isDeleted: boolean;
}

/**
 * What a scanner produces (before persistence: no id/firstSeenAt/lastScanId,
 * which are assigned by the repository layer on upsert).
 */
export type NormalizedResource = Omit<
  Resource,
  "id" | "firstSeenAt" | "lastSeenAt" | "lastScanId" | "isDeleted"
>;

/** Compact row shape for the Resource Explorer table + graph nodes. */
export interface ResourceSummary {
  id: string;
  service: ServiceName | string;
  type: string;
  name: string | null;
  state: string | null;
  region: string;
  environment: string | null;
  estimatedMonthlyCost: number | null;
  findingsCount: number;
}

/** Filters accepted by GET /resources. */
export interface ResourceFilter {
  accountId?: string;
  service?: string;
  region?: string;
  type?: string;
  state?: string;
  environment?: string;
  /** Fuzzy match on name. */
  search?: string;
  /** Only resources that have at least one open finding of this rule. */
  finding?: string;
  page?: number;
  pageSize?: number;
}
