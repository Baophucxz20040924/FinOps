import type { Account, AccountStatus } from "@infra-explorer/domain";
import type { AccountRow } from "@infra-explorer/db";

/** Maps a persisted account row to the domain shape (dates -> ISO strings). */
export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    awsAccountId: row.awsAccountId,
    displayName: row.displayName,
    roleArn: row.roleArn,
    externalId: row.externalId,
    status: row.status as AccountStatus,
    enabledRegions: row.enabledRegions,
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
