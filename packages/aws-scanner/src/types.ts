import type { AwsCredentialIdentityProvider } from "@smithy/types";
import type { Logger } from "@infra-explorer/shared";
import type {
  NormalizedResource,
  ResourceScope,
  ServiceName,
} from "@infra-explorer/domain";
import type { ApiCallRecorder } from "./api-recorder";

/** The target account context a scanner needs to make authenticated calls. */
export interface ScanTarget {
  accountId: string;
  awsAccountId: string;
  credentials: AwsCredentialIdentityProvider;
}

/** Everything a single scanner invocation is handed. */
export interface ScanContext {
  target: ScanTarget;
  /** Region code, or "global" for global scanners. */
  region: string;
  logger: Logger;
  recorder: ApiCallRecorder;
}

/** A non-fatal error from a scanner; collected rather than thrown. */
export interface ScannerError {
  service: ServiceName | string;
  region: string;
  message: string;
  throttled: boolean;
}

/**
 * What a scanner returns. It is partial-failure friendly: a scanner may return
 * some resources AND some errors from the same invocation.
 */
export interface RawDiscoveryResult {
  resources: NormalizedResource[];
  errors: ScannerError[];
}

/**
 * One scanner per AWS service. Scanners never throw on a single API failure for
 * their own service — they collect errors so the orchestrator can mark the
 * service THROTTLED/FAILED while keeping everything else (PARTIAL_SUCCESS).
 */
export interface ResourceScanner {
  readonly service: ServiceName | string;
  readonly scope: ResourceScope;
  scan(ctx: ScanContext): Promise<RawDiscoveryResult>;
}
