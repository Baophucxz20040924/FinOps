import { paginate } from "./pagination";
import { isThrottlingError } from "./retry";
import type { ScanContext, ScannerError } from "./types";

/**
 * Drives a paginated AWS call to completion, recording one API call per page
 * and one throttle per retried throttle, so scan stats stay accurate.
 */
export async function collectPaginated<TPage, TItem>(
  ctx: ScanContext,
  service: string,
  fetchPage: (
    token: string | undefined,
  ) => Promise<{ page: TPage; nextToken: string | undefined }>,
  extract: (page: TPage) => TItem[] | undefined,
): Promise<TItem[]> {
  return paginate(
    async (token) => {
      ctx.recorder.recordCall(service);
      return fetchPage(token);
    },
    extract,
    {
      retry: {
        onRetry: (_attempt, err) => {
          if (isThrottlingError(err)) ctx.recorder.recordThrottle(service);
        },
      },
    },
  );
}

/** Builds a ScannerError from a caught exception. */
export function toScannerError(
  service: string,
  region: string,
  err: unknown,
): ScannerError {
  const throttled = isThrottlingError(err);
  const message =
    err instanceof Error ? err.message : "Unknown scanner error";
  return { service, region, message, throttled };
}
