import { describe, it, expect } from "vitest";
import type { RelationshipType } from "@infra-explorer/domain";
import { deriveEdges } from "./derive";
import type { RelResource } from "./types";

const ACC = "acc-1";
const REGION = "us-west-2";

function r(
  id: string,
  service: string,
  type: string,
  externalId: string,
  metadata: Record<string, unknown> = {},
  overrides: Partial<RelResource> = {},
): RelResource {
  return {
    id,
    accountId: ACC,
    region: REGION,
    service,
    type,
    externalId,
    metadata,
    ...overrides,
  };
}

/** Full multi-tier fixture: vpc / subnet / sg / rtb / igw / nat / eip / instance / volume. */
function fullSet(): RelResource[] {
  return [
    r("u-vpc", "VPC", "vpc", "vpc-1"),
    r("u-subnet", "VPC", "subnet", "subnet-1", { vpcId: "vpc-1" }),
    r("u-sg", "VPC", "security-group", "sg-1", { vpcId: "vpc-1" }),
    r("u-rtb", "VPC", "route-table", "rtb-1", { vpcId: "vpc-1" }),
    r("u-igw", "VPC", "internet-gateway", "igw-1", { attachedVpcId: "vpc-1" }),
    r("u-eip", "VPC", "elastic-ip", "eipalloc-1", {}),
    r("u-nat", "VPC", "nat-gateway", "nat-1", {
      subnetId: "subnet-1",
      vpcId: "vpc-1",
      allocationIds: ["eipalloc-1"],
      publicIps: ["1.2.3.4"],
      eipRefs: ["eipalloc-1"],
    }),
    r("u-instance", "EC2", "instance", "i-1", {
      subnetId: "subnet-1",
      vpcId: "vpc-1",
      securityGroupIds: ["sg-1"],
    }),
    r("u-volume", "EBS", "volume", "vol-1", {
      attachedInstanceIds: ["i-1"],
    }),
  ];
}

function has(
  edges: { sourceResourceId: string; targetResourceId: string; type: string }[],
  source: string,
  target: string,
  type: RelationshipType,
): boolean {
  return edges.some(
    (e) =>
      e.sourceResourceId === source &&
      e.targetResourceId === target &&
      e.type === type,
  );
}

describe("deriveEdges — the 11 MVP edges", () => {
  it("derives every expected edge with correct type and direction", () => {
    const { edges, danglingRefs } = deriveEdges(fullSet());
    expect(danglingRefs).toBe(0);

    expect(has(edges, "u-instance", "u-subnet", "IN_SUBNET")).toBe(true); // 1
    expect(has(edges, "u-instance", "u-vpc", "IN_VPC")).toBe(true); // 2
    expect(has(edges, "u-instance", "u-sg", "USES_SG")).toBe(true); // 3
    expect(has(edges, "u-volume", "u-instance", "ATTACHED_TO")).toBe(true); // 4
    expect(has(edges, "u-subnet", "u-vpc", "MEMBER_OF")).toBe(true); // 5
    expect(has(edges, "u-sg", "u-vpc", "IN_VPC")).toBe(true); // 6
    expect(has(edges, "u-rtb", "u-vpc", "IN_VPC")).toBe(true); // 7
    expect(has(edges, "u-nat", "u-subnet", "IN_SUBNET")).toBe(true); // 8
    expect(has(edges, "u-nat", "u-vpc", "IN_VPC")).toBe(true); // 9
    expect(has(edges, "u-nat", "u-eip", "ROUTES_TO")).toBe(true); // 10
    expect(has(edges, "u-igw", "u-vpc", "IN_VPC")).toBe(true); // 11

    // every edge is VERIFIED
    expect(edges.every((e) => e.confidence === "VERIFIED")).toBe(true);
  });

  it("models subnet→vpc as MEMBER_OF, not IN_VPC", () => {
    const { edges } = deriveEdges(fullSet());
    expect(has(edges, "u-subnet", "u-vpc", "MEMBER_OF")).toBe(true);
    expect(has(edges, "u-subnet", "u-vpc", "IN_VPC")).toBe(false);
  });

  it("does not double-write the volume↔instance edge from the instance side", () => {
    const set = fullSet();
    // even if the instance also advertised volumeIds, no reverse edge appears
    const instance = set.find((x) => x.id === "u-instance")!;
    instance.metadata = { ...instance.metadata, volumeIds: ["vol-1"] };
    const { edges } = deriveEdges(set);
    const attach = edges.filter((e) => e.type === "ATTACHED_TO");
    expect(attach).toHaveLength(1);
    expect(has(edges, "u-volume", "u-instance", "ATTACHED_TO")).toBe(true);
  });
});

describe("deriveEdges — robustness", () => {
  it("counts a dangling reference and emits no edge when the target is absent", () => {
    const set = [
      r("u-instance", "EC2", "instance", "i-1", { subnetId: "subnet-missing" }),
    ];
    const { edges, danglingRefs } = deriveEdges(set);
    expect(edges).toHaveLength(0);
    expect(danglingRefs).toBe(1);
  });

  it("dedupes when the same security group is listed twice", () => {
    const set = [
      r("u-sg", "VPC", "security-group", "sg-1", { vpcId: "vpc-1" }),
      r("u-vpc", "VPC", "vpc", "vpc-1"),
      r("u-instance", "EC2", "instance", "i-1", {
        securityGroupIds: ["sg-1", "sg-1"],
      }),
    ];
    const { edges } = deriveEdges(set);
    expect(edges.filter((e) => e.type === "USES_SG")).toHaveLength(1);
  });

  it("treats a reference resolving to an unexpected service/type as dangling", () => {
    // subnetId 'sg-1' happens to match a security-group's external id, not a subnet
    const set = [
      r("u-sg", "VPC", "security-group", "shared-id"),
      r("u-instance", "EC2", "instance", "i-1", { subnetId: "shared-id" }),
    ];
    const { edges, danglingRefs } = deriveEdges(set);
    expect(edges.filter((e) => e.type === "IN_SUBNET")).toHaveLength(0);
    expect(danglingRefs).toBe(1);
  });

  it("drops a self-referential edge", () => {
    // contrived: a subnet whose vpcId points to its own external id
    const set = [r("u-x", "VPC", "subnet", "same", { vpcId: "same" })];
    const { edges } = deriveEdges(set);
    expect(edges).toHaveLength(0);
  });

  it("returns no edges for an empty set", () => {
    expect(deriveEdges([])).toEqual({ edges: [], danglingRefs: 0 });
  });

  it("ignores malformed metadata without throwing", () => {
    const set = [
      r("u-instance", "EC2", "instance", "i-1", {
        subnetId: 123, // wrong type
        securityGroupIds: "sg-1", // not an array
      }),
    ];
    const { edges, danglingRefs } = deriveEdges(set);
    expect(edges).toHaveLength(0);
    expect(danglingRefs).toBe(0);
  });

  it("derives edges over the full set regardless of which scan discovered each resource (HIGH-fix)", () => {
    // The engine loads the full LIVE set (not last_scan_id-scoped); prove derive
    // works over a mixed set where endpoints came from different scans.
    const set = [
      r("u-vpc", "VPC", "vpc", "vpc-1"), // discovered by an earlier scan
      r("u-instance", "EC2", "instance", "i-1", { vpcId: "vpc-1" }), // this scan
    ];
    const { edges } = deriveEdges(set);
    expect(has(edges, "u-instance", "u-vpc", "IN_VPC")).toBe(true);
  });
});
