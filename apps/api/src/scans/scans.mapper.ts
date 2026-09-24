import type { Scan, ScanStats, ScanStatus, ServiceResult } from "@infra-explorer/domain";
import type { ScanRow } from "@infra-explorer/db";

export function toScan(row: ScanRow): Scan {
  return {
    id: row.id,
    accountId: row.accountId,
    regions: row.regions,
    status: row.status as ScanStatus,
    triggeredBy: row.triggeredBy,
    serviceResults: (row.serviceResults ?? []) as ServiceResult[],
    stats: (row.stats ?? {}) as ScanStats,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
