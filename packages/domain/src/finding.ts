import type { Confidence, IsoTimestamp } from "./common";

/** The deterministic rules the engine can emit. */
export type FindingRule =
  | "POSSIBLE_IDLE_INSTANCE"
  | "UNATTACHED_EBS"
  | "UNUSED_ELASTIC_IP"
  | "POSSIBLE_OVERSIZED_RDS"
  | "LOW_USAGE_LOAD_BALANCER"
  | "LOW_USAGE_NAT_GATEWAY"
  | "STOPPED_INSTANCE_STILL_BILLED_EBS";

export type Severity = "low" | "medium" | "high";

export type FindingStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED";

/** Arbitrary structured evidence supporting a finding, shown in the UI. */
export type Evidence = Record<string, unknown>;

/**
 * A single evidence-backed observation about a resource. Findings never claim
 * guaranteed savings — every one carries a Confidence and its raw evidence.
 */
export interface Finding {
  id: string;
  resourceId: string;
  rule: FindingRule;
  severity: Severity;
  status: FindingStatus;
  evidence: Evidence;
  estimatedMonthlyCost: number | null;
  potentialMonthlySavings: number | null;
  confidence: Confidence;
  discoveredInScanId: string | null;
  createdAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
}

/** What a rule emits before persistence (upserted per resource+rule). */
export interface NormalizedFinding {
  resourceId: string;
  rule: FindingRule;
  severity: Severity;
  evidence: Evidence;
  estimatedMonthlyCost: number | null;
  potentialMonthlySavings: number | null;
  confidence: Confidence;
}

export interface FindingFilter {
  accountId?: string;
  resourceId?: string;
  rule?: FindingRule;
  severity?: Severity;
  status?: FindingStatus;
  service?: string;
  page?: number;
  pageSize?: number;
}
