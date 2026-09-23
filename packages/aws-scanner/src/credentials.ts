import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@smithy/types";

/**
 * Strict validation for a user-supplied IAM role ARN. Reject anything that does
 * not match before ever calling AssumeRole with it, so the API cannot be used
 * as an arbitrary-ARN probe.
 */
const ROLE_ARN_RE = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

export function isValidRoleArn(arn: string): boolean {
  return ROLE_ARN_RE.test(arn);
}

/** Extracts the 12-digit account id from a role ARN, or null if malformed. */
export function accountIdFromRoleArn(arn: string): string | null {
  const match = /^arn:aws:iam::(\d{12}):role\//.exec(arn);
  return match?.[1] ?? null;
}

export interface AssumeRoleParams {
  roleArn: string;
  externalId: string;
  sessionName?: string;
  durationSeconds?: number;
  /** Region for the STS client; defaults to us-east-1. */
  region?: string;
}

const DEFAULT_SESSION_NAME = "infra-explorer";
const DEFAULT_DURATION_SECONDS = 3600;

/**
 * Returns an auto-refreshing credential provider for the target account. The
 * platform's own identity (env / profile / ECS task role) is used as the source
 * identity; only short-lived STS credentials are ever produced — nothing is
 * persisted.
 */
export function createAssumedCredentials(
  params: AssumeRoleParams,
): AwsCredentialIdentityProvider {
  return fromTemporaryCredentials({
    params: {
      RoleArn: params.roleArn,
      RoleSessionName: params.sessionName ?? DEFAULT_SESSION_NAME,
      ExternalId: params.externalId,
      DurationSeconds: params.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    },
    clientConfig: { region: params.region ?? "us-east-1" },
  });
}

export type VerifyResult =
  | { ok: true; assumedAccountId: string | null }
  | { ok: false; error: string };

/**
 * Attempts a single AssumeRole against the target account and confirms the
 * resulting credentials work (GetCallerIdentity). Maps AWS errors to
 * client-safe messages — never leaks a raw SDK stack trace.
 */
export async function verifyAccountAccess(
  params: AssumeRoleParams,
): Promise<VerifyResult> {
  if (!isValidRoleArn(params.roleArn)) {
    return { ok: false, error: "Invalid role ARN format." };
  }

  const region = params.region ?? "us-east-1";
  const sts = new STSClient({ region });

  try {
    await sts.send(
      new AssumeRoleCommand({
        RoleArn: params.roleArn,
        RoleSessionName: params.sessionName ?? DEFAULT_SESSION_NAME,
        ExternalId: params.externalId,
        DurationSeconds: params.durationSeconds ?? DEFAULT_DURATION_SECONDS,
      }),
    );

    // Confirm the assumed credentials are actually usable.
    const assumed = new STSClient({
      region,
      credentials: createAssumedCredentials({ ...params, region }),
    });
    const identity = await assumed.send(new GetCallerIdentityCommand({}));
    return { ok: true, assumedAccountId: identity.Account ?? null };
  } catch (err) {
    return { ok: false, error: mapStsError(err) };
  }
}

/** Translates common STS failures into actionable, non-leaky messages. */
export function mapStsError(err: unknown): string {
  const name =
    (err as { name?: string })?.name ??
    (err as { Code?: string })?.Code ??
    "";

  switch (name) {
    case "AccessDenied":
    case "AccessDeniedException":
      return "Access denied assuming the role. Check the role's trust policy allows the platform's worker role and that the ExternalId matches.";
    case "ValidationError":
      return "The role ARN or request parameters were rejected by AWS. Verify the role ARN is correct.";
    case "NoSuchEntity":
      return "The specified role does not exist in the target account.";
    case "ExpiredToken":
    case "ExpiredTokenException":
      return "The platform's own credentials have expired. Retry shortly.";
    case "RegionDisabledException":
      return "STS is disabled for the selected region in the target account.";
    default:
      return "Could not assume the role. Verify the role ARN, trust policy, and ExternalId, then try again.";
  }
}
