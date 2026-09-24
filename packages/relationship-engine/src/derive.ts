import type { RelationshipType, ResourceMetadata } from "@infra-explorer/domain";
import { joinKey } from "@infra-explorer/db";
import { buildResourceIndex, indexKey, type ResourceIndex } from "./index-map";
import type { DerivedEdge, DeriveResult, RelResource } from "./types";

/** Reads a string metadata field, or null if absent/wrong type. */
function readString(meta: ResourceMetadata, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Reads a string[] metadata field, coercing away non-strings; [] if absent. */
function readStringArray(meta: ResourceMetadata, key: string): string[] {
  const v = meta[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x !== "");
}

/**
 * Pure edge derivation over a live resource set. Never throws: unresolved
 * references (target not in the set, or resolved to an unexpected service/type)
 * are counted as dangling and skipped; self-edges are dropped; duplicate
 * (source,target,type) edges are collapsed.
 *
 * External-id → resource resolution is keyed by (accountId, region, externalId)
 * — every reference in this set is same-account and same-region. The `expect`
 * allow-list (a set of "service/type" strings) guards against a raw id
 * resolving to a row from a different namespace.
 */
export function deriveEdges(resources: RelResource[]): DeriveResult {
  const index: ResourceIndex = buildResourceIndex(resources);
  const edges: DerivedEdge[] = [];
  const seen = new Set<string>();
  let danglingRefs = 0;

  const link = (
    source: RelResource,
    rawIds: string | string[] | null,
    type: RelationshipType,
    expect: readonly string[],
  ): void => {
    const ids = rawIds === null ? [] : Array.isArray(rawIds) ? rawIds : [rawIds];
    for (const rawId of ids) {
      if (!rawId) continue;
      const target = index.get(indexKey(source.accountId, source.region, rawId));
      if (!target) {
        danglingRefs += 1;
        continue;
      }
      if (!expect.includes(`${target.service}/${target.type}`)) {
        // Resolved to an unexpected namespace — treat as dangling, don't mislink.
        danglingRefs += 1;
        continue;
      }
      if (target.id === source.id) continue; // self-edge guard
      const dedupeKey = joinKey(source.id, target.id, type);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      edges.push({
        sourceResourceId: source.id,
        targetResourceId: target.id,
        type,
        confidence: "VERIFIED",
      });
    }
  };

  const SUBNET = ["VPC/subnet"] as const;
  const VPC = ["VPC/vpc"] as const;
  const SG = ["VPC/security-group"] as const;
  const INSTANCE = ["EC2/instance"] as const;
  const EIP = ["VPC/elastic-ip"] as const;

  for (const r of resources) {
    const st = `${r.service}/${r.type}`;
    const m = r.metadata;
    switch (st) {
      case "EC2/instance":
        link(r, readString(m, "subnetId"), "IN_SUBNET", SUBNET);
        link(r, readString(m, "vpcId"), "IN_VPC", VPC);
        link(r, readStringArray(m, "securityGroupIds"), "USES_SG", SG);
        break;
      case "EBS/volume":
        // Authoritative side for the volume↔instance edge (instance side ignored).
        link(r, readStringArray(m, "attachedInstanceIds"), "ATTACHED_TO", INSTANCE);
        break;
      case "VPC/subnet":
        // Domain models subnet→vpc as MEMBER_OF (not IN_VPC).
        link(r, readString(m, "vpcId"), "MEMBER_OF", VPC);
        break;
      case "VPC/security-group":
        link(r, readString(m, "vpcId"), "IN_VPC", VPC);
        break;
      case "VPC/route-table":
        link(r, readString(m, "vpcId"), "IN_VPC", VPC);
        break;
      case "VPC/nat-gateway":
        link(r, readString(m, "subnetId"), "IN_SUBNET", SUBNET);
        link(r, readString(m, "vpcId"), "IN_VPC", VPC);
        // eipRefs is per-address AllocationId ?? PublicIp — the exact elastic-ip
        // externalId, so each resolves with one lookup and no false dangling.
        link(r, readStringArray(m, "eipRefs"), "ROUTES_TO", EIP);
        break;
      case "VPC/internet-gateway":
        link(r, readString(m, "attachedVpcId"), "IN_VPC", VPC);
        break;
      default:
        break;
    }
  }

  return { edges, danglingRefs };
}
