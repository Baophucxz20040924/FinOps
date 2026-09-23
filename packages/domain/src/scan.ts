import type { IsoTimestamp, ServiceName } from "./common";

export type ScanStatus =
  | "QUEUED"
  | "RUNNING"
  | "PARTIAL_SUCCESS"
  | "SUCCESS"
  | "FAILED";

export type ServiceScanStatus = "OK" | "FAILED" | "THROTTLED";

/**
 * Per-service outcome within a scan. A single failed/throttled service does not
 * fail the whole scan — it is recorded here and the scan becomes PARTIAL_SUCCESS.
 */
export interface ServiceResult {
  service: ServiceName | string;
  region: string;
  status: ServiceScanStatus;
  resourceCount: number;
  error?: string;
}

export interface ScanStats {
  resourcesDiscovered: number;
  findingsGenerated: number;
  apiCallsMade: number;
  apiThrottles: number;
  durationMs?: number;
}

/** One execution of the scan pipeline against an account + set of regions. */
export interface Scan {
  id: string;
  accountId: string;
  regions: string[];
  status: ScanStatus;
  /** userId | "schedule" | "cli" */
  triggeredBy: string;
  serviceResults: ServiceResult[];
  stats: ScanStats;
  startedAt: IsoTimestamp | null;
  finishedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
}

export interface CreateScanInput {
  accountId: string;
  regions: string[];
}
