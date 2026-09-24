/** Name of the pg-boss queue that carries scan jobs. */
export const SCAN_QUEUE = "run-scan";

/** Payload for a scan job. */
export interface ScanJob {
  scanId: string;
}
