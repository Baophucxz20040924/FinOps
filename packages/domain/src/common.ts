/**
 * Shared primitives used across the domain model.
 */

/** ISO-8601 timestamp string (e.g. "2026-09-23T10:15:00.000Z"). */
export type IsoTimestamp = string;

/** 12-digit AWS account id. */
export type AwsAccountId = string;

/**
 * Confidence attached to any derived fact (relationship, finding, cost).
 *
 * - VERIFIED  — directly reported by AWS as a fact (e.g. volume state = available)
 * - INFERRED  — derived from utilization/heuristics; plausible but not certain
 * - ESTIMATED — computed from a pricing model, not AWS-billed truth
 * - UNKNOWN   — could not be fully evaluated (e.g. insufficient metric history)
 */
export type Confidence = "VERIFIED" | "INFERRED" | "ESTIMATED" | "UNKNOWN";

/** AWS service families the platform understands. */
export type ServiceName =
  | "EC2"
  | "EBS"
  | "VPC"
  | "RDS"
  | "ECS"
  | "ALB"
  | "S3"
  | "Lambda"
  | "SQS"
  | "CloudFront";

/** Whether a scanner/resource is scoped to a region or is global. */
export type ResourceScope = "REGIONAL" | "GLOBAL";

/** Sentinel region value stored for global resources (CloudFront, etc.). */
export const GLOBAL_REGION = "global" as const;

/** Generic paginated list envelope returned by list endpoints. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
