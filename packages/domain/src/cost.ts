import type { IsoTimestamp } from "./common";

export type CostScope = "ACCOUNT" | "SERVICE" | "RESOURCE";
export type CostGranularity = "DAILY" | "MONTHLY";

/**
 * Where a cost figure came from. These are NEVER conflated in the UI:
 * - COST_EXPLORER   = actual AWS-billed cost (may lag ~24h, account/service level)
 * - PRICING_ESTIMATE = modelled estimate from a pricing table x observed usage
 */
export type CostSource = "COST_EXPLORER" | "PRICING_ESTIMATE";

export interface CostSnapshot {
  id: string;
  accountId: string;
  /** Null for ACCOUNT/SERVICE scope. */
  resourceId: string | null;
  /** Null for RESOURCE scope. */
  service: string | null;
  scope: CostScope;
  granularity: CostGranularity;
  periodStart: string; // date (YYYY-MM-DD)
  periodEnd: string; // date (YYYY-MM-DD)
  amount: number;
  currency: string;
  source: CostSource;
  createdAt: IsoTimestamp;
}

/** Response shape for the Overview cost card — actual vs estimated vs savings. */
export interface CostSummary {
  /** Actual billed cost by service, from Cost Explorer. */
  actual: Array<{ service: string; amount: number; source: "COST_EXPLORER" }>;
  /** Modelled current run-rate across resources. */
  estimatedTotal: number;
  /** Sum of potential savings from open findings (never guaranteed). */
  potentialSavings: number;
  currency: string;
}
