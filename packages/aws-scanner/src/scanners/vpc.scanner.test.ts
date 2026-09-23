import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeRouteTablesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeAddressesCommand,
} from "@aws-sdk/client-ec2";
import type { Logger } from "@infra-explorer/shared";
import type { NormalizedResource } from "@infra-explorer/domain";
import { ApiCallRecorder } from "../api-recorder";
import type { ScanContext } from "../types";
import { VpcScanner } from "./vpc.scanner";

const ec2Mock = mockClient(EC2Client);

function makeCtx(): { ctx: ScanContext; recorder: ApiCallRecorder } {
  const recorder = new ApiCallRecorder();
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  const ctx: ScanContext = {
    target: {
      accountId: "acc-uuid",
      awsAccountId: "123456789012",
      credentials: async () => ({ accessKeyId: "x", secretAccessKey: "y" }),
    },
    region: "us-west-2",
    logger,
    recorder,
  };
  return { ctx, recorder };
}

function byType(
  resources: NormalizedResource[],
  type: string,
): NormalizedResource | undefined {
  return resources.find((r) => r.type === type);
}

/** Empty defaults so unstubbed commands resolve to nothing rather than error. */
function stubAllEmpty(): void {
  ec2Mock.on(DescribeVpcsCommand).resolves({ Vpcs: [] });
  ec2Mock.on(DescribeSubnetsCommand).resolves({ Subnets: [] });
  ec2Mock.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
  ec2Mock.on(DescribeRouteTablesCommand).resolves({ RouteTables: [] });
  ec2Mock.on(DescribeInternetGatewaysCommand).resolves({ InternetGateways: [] });
  ec2Mock.on(DescribeNatGatewaysCommand).resolves({ NatGateways: [] });
  ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });
}

beforeEach(() => {
  ec2Mock.reset();
});

describe("VpcScanner", () => {
  it("normalizes each sub-type with correct type, state, and relationship metadata", async () => {
    stubAllEmpty();
    ec2Mock.on(DescribeVpcsCommand).resolves({
      Vpcs: [
        {
          VpcId: "vpc-1",
          State: "available",
          CidrBlock: "10.0.0.0/16",
          IsDefault: false,
          Tags: [{ Key: "Name", Value: "main-vpc" }],
        },
      ],
    });
    ec2Mock.on(DescribeSubnetsCommand).resolves({
      Subnets: [
        {
          SubnetId: "subnet-1",
          VpcId: "vpc-1",
          State: "available",
          CidrBlock: "10.0.1.0/24",
          AvailabilityZone: "us-west-2a",
        },
      ],
    });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [
        {
          GroupId: "sg-1",
          GroupName: "web",
          Description: "web sg",
          VpcId: "vpc-1",
          IpPermissions: [{ UserIdGroupPairs: [{ GroupId: "sg-2" }] }],
          IpPermissionsEgress: [],
        },
      ],
    });
    ec2Mock.on(DescribeRouteTablesCommand).resolves({
      RouteTables: [
        {
          RouteTableId: "rtb-1",
          VpcId: "vpc-1",
          Associations: [{ Main: true }, { SubnetId: "subnet-1" }],
          Routes: [
            { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local" },
            { DestinationCidrBlock: "0.0.0.0/0", NatGatewayId: "nat-1" },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeInternetGatewaysCommand).resolves({
      InternetGateways: [
        {
          InternetGatewayId: "igw-1",
          Attachments: [{ VpcId: "vpc-1", State: "available" }],
        },
      ],
    });
    ec2Mock.on(DescribeNatGatewaysCommand).resolves({
      NatGateways: [
        {
          NatGatewayId: "nat-1",
          State: "available",
          VpcId: "vpc-1",
          SubnetId: "subnet-1",
          ConnectivityType: "public",
          NatGatewayAddresses: [
            { AllocationId: "eipalloc-1", PublicIp: "1.2.3.4" },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeAddressesCommand).resolves({
      Addresses: [
        { AllocationId: "eipalloc-1", PublicIp: "1.2.3.4", AssociationId: "eipassoc-1" },
        { AllocationId: "eipalloc-2", PublicIp: "5.6.7.8" },
      ],
    });

    const { ctx } = makeCtx();
    const result = await new VpcScanner().scan(ctx);

    expect(result.errors).toHaveLength(0);
    expect(result.resources.every((r) => r.service === "VPC")).toBe(true);

    const vpc = byType(result.resources, "vpc")!;
    expect(vpc.state).toBe("available");
    expect(vpc.name).toBe("main-vpc");
    expect(vpc.arn).toBe("arn:aws:ec2:us-west-2:123456789012:vpc/vpc-1");

    const subnet = byType(result.resources, "subnet")!;
    expect(subnet.metadata.vpcId).toBe("vpc-1");
    expect(subnet.state).toBe("available");

    const sg = byType(result.resources, "security-group")!;
    expect(sg.metadata.vpcId).toBe("vpc-1");
    expect(sg.state).toBeNull();
    expect(sg.metadata.referencedSecurityGroupIds).toEqual(["sg-2"]);
    expect(sg.name).toBe("web");

    const rt = byType(result.resources, "route-table")!;
    expect(rt.metadata.vpcId).toBe("vpc-1");
    expect(rt.metadata.isMain).toBe(true);
    expect(rt.metadata.associatedSubnetIds).toEqual(["subnet-1"]);
    // "local" next-hop excluded; nat-1 kept
    expect(rt.metadata.routeTargetIds).toEqual(["nat-1"]);

    const igw = byType(result.resources, "internet-gateway")!;
    expect(igw.state).toBe("attached");
    expect(igw.metadata.attachedVpcId).toBe("vpc-1");

    const nat = byType(result.resources, "nat-gateway")!;
    expect(nat.state).toBe("available");
    expect(nat.metadata.subnetId).toBe("subnet-1");
    expect(nat.metadata.vpcId).toBe("vpc-1");
    expect(nat.metadata.allocationIds).toEqual(["eipalloc-1"]);

    const eips = result.resources.filter((r) => r.type === "elastic-ip");
    expect(eips).toHaveLength(2);
    expect(eips.find((e) => e.externalId === "eipalloc-1")!.state).toBe("in-use");
    expect(eips.find((e) => e.externalId === "eipalloc-2")!.state).toBe("unused");
  });

  it("isolates a throttled sub-type while keeping the others (partial failure)", async () => {
    stubAllEmpty();
    ec2Mock.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-1" }] });
    ec2Mock
      .on(DescribeSecurityGroupsCommand)
      .rejects(
        Object.assign(new Error("rate exceeded"), {
          name: "ThrottlingException",
        }),
      );

    const { ctx } = makeCtx();
    const result = await new VpcScanner().scan(ctx);

    // VPC still discovered despite the SG throttle
    expect(byType(result.resources, "vpc")).toBeDefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.service).toBe("VPC");
    expect(result.errors[0]!.throttled).toBe(true);
  });

  it("makes exactly one API call for the non-paginated DescribeAddresses", async () => {
    stubAllEmpty();
    ec2Mock.on(DescribeAddressesCommand).resolves({
      Addresses: [{ AllocationId: "eipalloc-1", PublicIp: "1.2.3.4" }],
    });

    const { ctx } = makeCtx();
    await new VpcScanner().scan(ctx);

    const addressCalls = ec2Mock
      .commandCalls(DescribeAddressesCommand)
      .length;
    expect(addressCalls).toBe(1);
  });

  it("follows NextToken pagination for a paginated describe", async () => {
    stubAllEmpty();
    ec2Mock
      .on(DescribeVpcsCommand)
      .resolvesOnce({ Vpcs: [{ VpcId: "vpc-1" }], NextToken: "p2" })
      .resolves({ Vpcs: [{ VpcId: "vpc-2" }] });

    const { ctx } = makeCtx();
    const result = await new VpcScanner().scan(ctx);

    const vpcs = result.resources.filter((r) => r.type === "vpc");
    expect(vpcs.map((v) => v.externalId).sort()).toEqual(["vpc-1", "vpc-2"]);
    expect(ec2Mock.commandCalls(DescribeVpcsCommand).length).toBe(2);
  });

  it("drops items with a missing native id without throwing", async () => {
    stubAllEmpty();
    ec2Mock
      .on(DescribeVpcsCommand)
      .resolves({ Vpcs: [{ CidrBlock: "10.0.0.0/16" }] }); // no VpcId

    const { ctx } = makeCtx();
    const result = await new VpcScanner().scan(ctx);
    expect(result.resources.filter((r) => r.type === "vpc")).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
