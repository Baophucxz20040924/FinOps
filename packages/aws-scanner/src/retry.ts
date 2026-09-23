/** AWS error names / codes that indicate throttling or transient failure. */
const THROTTLE_NAMES = new Set([
  "ThrottlingException",
  "Throttling",
  "TooManyRequestsException",
  "RequestLimitExceeded",
  "RequestThrottled",
  "RequestThrottledException",
  "ProvisionedThroughputExceededException",
  "TransactionInProgressException",
  "SlowDown",
  "EC2ThrottledException",
]);

const RETRYABLE_NAMES = new Set([
  ...THROTTLE_NAMES,
  "InternalError",
  "InternalFailure",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "RequestTimeout",
  "RequestTimeoutException",
]);

function errorName(err: unknown): string {
  return (
    (err as { name?: string })?.name ??
    (err as { Code?: string })?.Code ??
    ""
  );
}

export function isThrottlingError(err: unknown): boolean {
  const name = errorName(err);
  if (THROTTLE_NAMES.has(name)) return true;
  // Some SDK errors expose an http status of 429.
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return status === 429;
}

export function isRetryableError(err: unknown): boolean {
  if (isThrottlingError(err)) return true;
  const name = errorName(err);
  if (RETRYABLE_NAMES.has(name)) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return status !== undefined && status >= 500;
}

export interface RetryOptions {
  maxAttempts?: number;
  /** Base delay in ms for the first backoff. */
  baseDelayMs?: number;
  /** Ceiling for a single backoff delay. */
  maxDelayMs?: number;
  /** Deterministic jitter source (0..1); defaults to Math.random. */
  random?: () => number;
  /** Sleep implementation (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry with attempt number and the error. */
  onRetry?: (attempt: number, err: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` with exponential backoff + full jitter, retrying only on
 * throttling/transient errors. Non-retryable errors are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 20_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableError(err)) {
        throw err;
      }
      // Exponential backoff with full jitter: delay in [0, min(cap, base*2^n)].
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(random() * exp);
      options.onRetry?.(attempt, err);
      await sleep(delay);
    }
  }
}
