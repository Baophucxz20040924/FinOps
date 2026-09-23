import type { AwsAccountId, IsoTimestamp } from "./common";

export type AccountStatus =
  | "PENDING_VERIFICATION"
  | "ACTIVE"
  | "INVALID"
  | "DISABLED";

/**
 * A target AWS account the platform can scan. Access is always via
 * cross-account `sts:AssumeRole` using the stored roleArn + externalId.
 * No long-lived AWS keys are ever stored.
 */
export interface Account {
  id: string;
  awsAccountId: AwsAccountId;
  displayName: string;
  /** Role the platform assumes in the target account. */
  roleArn: string;
  /** Per-account generated ExternalId, required in the role's trust policy. */
  externalId: string;
  status: AccountStatus;
  /** Regions this account is scanned across. */
  enabledRegions: string[];
  /** For AWS Organizations grouping (V2+); null for standalone accounts. */
  organizationId: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Payload to register a new account. */
export interface CreateAccountInput {
  displayName: string;
  awsAccountId: AwsAccountId;
  roleArn: string;
  enabledRegions: string[];
}

/** Result of attempting `sts:AssumeRole` against a registered account. */
export interface AccountVerificationResult {
  accountId: string;
  status: Extract<AccountStatus, "ACTIVE" | "INVALID">;
  /** Human-safe error message when INVALID (never a raw SDK stack trace). */
  error?: string;
}
