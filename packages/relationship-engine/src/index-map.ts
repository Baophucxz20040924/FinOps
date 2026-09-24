import { joinKey } from "@infra-explorer/db";
import type { RelResource } from "./types";

export type ResourceIndex = ReadonlyMap<string, RelResource>;

/**
 * Index key for external-id → internal-uuid resolution. Keyed by
 * (accountId, region, externalId): every reference in the current edge set is
 * same-account AND same-region, so this resolves them without cross-region
 * collision. `service` is deliberately omitted because the referencing side
 * only knows a raw AWS id, not the target's service — the derive step guards
 * against namespace collisions with a per-edge service/type allow-list instead.
 */
export function indexKey(
  accountId: string,
  region: string,
  externalId: string,
): string {
  return joinKey(accountId, region, externalId);
}

/** Builds the resolution index over a set of resources (last-wins on collision). */
export function buildResourceIndex(resources: RelResource[]): ResourceIndex {
  const map = new Map<string, RelResource>();
  for (const r of resources) {
    map.set(indexKey(r.accountId, r.region, r.externalId), r);
  }
  return map;
}
