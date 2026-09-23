import type {
  Address,
  InternetGateway,
  NatGateway,
  RouteTable,
  SecurityGroup,
  Subnet,
  Vpc,
} from "@aws-sdk/client-ec2";
import type { NormalizedResource } from "@infra-explorer/domain";
import { ec2Arn } from "../arn";
import { deriveEnvironment, deriveName, tagListToRecord } from "./tags";
import { definedStrings, type NormalizeContext } from "./context";

/**
 * Normalizers for the VPC service family. Every sub-type becomes a distinct
 * Resource.type under service "VPC". Each normalizer stashes the
 * relationship-relevant AWS ids (vpcId, subnetId, allocationIds, ...) in
 * metadata using the exact field names the relationship engine (INFRA-010)
 * reads — these field names are a contract, do not rename them.
 */

/** vpc — target-only in the current edge set (nothing points out of it). */
export function normalizeVpc(
  vpc: Vpc,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = vpc.VpcId;
  if (!id) return null;
  const tags = tagListToRecord(vpc.Tags);
  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `vpc/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "vpc",
    name: deriveName(tags, id),
    state: vpc.State ?? null,
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      cidrBlock: vpc.CidrBlock ?? null,
      cidrBlockAssociationSet: definedStrings(
        (vpc.CidrBlockAssociationSet ?? []).map((a) => a.CidrBlock),
      ),
      ipv6CidrBlocks: definedStrings(
        (vpc.Ipv6CidrBlockAssociationSet ?? []).map((a) => a.Ipv6CidrBlock),
      ),
      isDefault: vpc.IsDefault ?? null,
      instanceTenancy: vpc.InstanceTenancy ?? null,
      dhcpOptionsId: vpc.DhcpOptionsId ?? null,
      ownerId: vpc.OwnerId ?? null,
    },
  };
}

/** subnet — points at its VPC (MEMBER_OF edge in the engine). */
export function normalizeSubnet(
  subnet: Subnet,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = subnet.SubnetId;
  if (!id) return null;
  const tags = tagListToRecord(subnet.Tags);
  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `subnet/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "subnet",
    name: deriveName(tags, id),
    state: subnet.State ?? null,
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      vpcId: subnet.VpcId ?? null,
      cidrBlock: subnet.CidrBlock ?? null,
      ipv6CidrBlocks: definedStrings(
        (subnet.Ipv6CidrBlockAssociationSet ?? []).map((a) => a.Ipv6CidrBlock),
      ),
      availabilityZone: subnet.AvailabilityZone ?? null,
      availabilityZoneId: subnet.AvailabilityZoneId ?? null,
      availableIpAddressCount: subnet.AvailableIpAddressCount ?? null,
      mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch ?? null,
      defaultForAz: subnet.DefaultForAz ?? null,
      ownerId: subnet.OwnerId ?? null,
    },
  };
}

/** security-group — points at its VPC (IN_VPC edge). */
export function normalizeSecurityGroup(
  group: SecurityGroup,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = group.GroupId;
  if (!id) return null;
  const tags = tagListToRecord(group.Tags);
  const referencedSecurityGroupIds = definedStrings([
    ...(group.IpPermissions ?? []).flatMap((p) =>
      (p.UserIdGroupPairs ?? []).map((u) => u.GroupId),
    ),
    ...(group.IpPermissionsEgress ?? []).flatMap((p) =>
      (p.UserIdGroupPairs ?? []).map((u) => u.GroupId),
    ),
  ]);
  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `security-group/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "security-group",
    name: deriveName(tags, group.GroupName ?? id),
    state: null, // AWS reports no lifecycle state for SGs
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      vpcId: group.VpcId ?? null, // null for retired EC2-Classic groups
      groupName: group.GroupName ?? null,
      description: group.Description ?? null,
      referencedSecurityGroupIds,
      ingressRuleCount: (group.IpPermissions ?? []).length,
      egressRuleCount: (group.IpPermissionsEgress ?? []).length,
      ownerId: group.OwnerId ?? null,
    },
  };
}

/** route-table — points at its VPC (IN_VPC edge). */
export function normalizeRouteTable(
  rt: RouteTable,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = rt.RouteTableId;
  if (!id) return null;
  const tags = tagListToRecord(rt.Tags);
  const associations = rt.Associations ?? [];
  const routes = (rt.Routes ?? []).map((r) => ({
    destinationCidrBlock: r.DestinationCidrBlock ?? null,
    gatewayId: r.GatewayId ?? null,
    natGatewayId: r.NatGatewayId ?? null,
    instanceId: r.InstanceId ?? null,
    networkInterfaceId: r.NetworkInterfaceId ?? null,
    transitGatewayId: r.TransitGatewayId ?? null,
    vpcPeeringConnectionId: r.VpcPeeringConnectionId ?? null,
    egressOnlyInternetGatewayId: r.EgressOnlyInternetGatewayId ?? null,
    state: r.State ?? null,
    origin: r.Origin ?? null,
  }));
  const routeTargetIds = definedStrings(
    (rt.Routes ?? []).flatMap((r) => [
      r.GatewayId,
      r.NatGatewayId,
      r.InstanceId,
      r.NetworkInterfaceId,
      r.TransitGatewayId,
      r.VpcPeeringConnectionId,
      r.EgressOnlyInternetGatewayId,
    ]),
  ).filter((v) => v !== "local");
  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `route-table/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "route-table",
    name: deriveName(tags, id),
    state: null,
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      vpcId: rt.VpcId ?? null,
      associatedSubnetIds: definedStrings(associations.map((a) => a.SubnetId)),
      associatedGatewayIds: definedStrings(associations.map((a) => a.GatewayId)),
      isMain: associations.some((a) => a.Main === true),
      routes,
      routeTargetIds: [...new Set(routeTargetIds)],
      propagatingVgwIds: definedStrings(
        (rt.PropagatingVgws ?? []).map((v) => v.GatewayId),
      ),
      ownerId: rt.OwnerId ?? null,
    },
  };
}

/** internet-gateway — points at the VPC it is attached to (IN_VPC edge). */
export function normalizeInternetGateway(
  igw: InternetGateway,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = igw.InternetGatewayId;
  if (!id) return null;
  const tags = tagListToRecord(igw.Tags);
  const attachedVpcIds = definedStrings(
    (igw.Attachments ?? []).map((a) => a.VpcId),
  );
  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `internet-gateway/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "internet-gateway",
    name: deriveName(tags, id),
    state: attachedVpcIds.length > 0 ? "attached" : "detached",
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      attachedVpcId: attachedVpcIds[0] ?? null,
      attachedVpcIds,
      attachmentStates: definedStrings(
        (igw.Attachments ?? []).map((a) => a.State),
      ),
      ownerId: igw.OwnerId ?? null,
    },
  };
}

/** nat-gateway — points at its subnet (IN_SUBNET), VPC (IN_VPC), EIPs (ROUTES_TO). */
export function normalizeNatGateway(
  nat: NatGateway,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = nat.NatGatewayId;
  if (!id) return null;
  const tags = tagListToRecord(nat.Tags);
  const addresses = nat.NatGatewayAddresses ?? [];
  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `natgateway/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "nat-gateway",
    name: deriveName(tags, id),
    state: nat.State ?? null,
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      vpcId: nat.VpcId ?? null,
      subnetId: nat.SubnetId ?? null,
      connectivityType: nat.ConnectivityType ?? null,
      allocationIds: definedStrings(addresses.map((a) => a.AllocationId)),
      publicIps: definedStrings(addresses.map((a) => a.PublicIp)),
      associationIds: definedStrings(addresses.map((a) => a.AssociationId)),
      networkInterfaceIds: definedStrings(
        addresses.map((a) => a.NetworkInterfaceId),
      ),
      privateIps: definedStrings(addresses.map((a) => a.PrivateIp)),
      createTime: nat.CreateTime?.toISOString() ?? null,
      failureCode: nat.FailureCode ?? null,
      failureMessage: nat.FailureMessage ?? null,
    },
  };
}

/**
 * elastic-ip — state reflects association ("unused" drives UNUSED_ELASTIC_IP).
 * externalId is the AllocationId (VPC EIPs), falling back to the PublicIp.
 */
export function normalizeElasticIp(
  address: Address,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = address.AllocationId ?? address.PublicIp;
  if (!id) return null;
  const tags = tagListToRecord(address.Tags);
  const associated = Boolean(
    address.AssociationId ?? address.InstanceId ?? address.NetworkInterfaceId,
  );
  return {
    arn: address.AllocationId
      ? ec2Arn(ctx.region, ctx.awsAccountId, `elastic-ip/${address.AllocationId}`)
      : null,
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "VPC",
    type: "elastic-ip",
    name: deriveName(tags, id),
    state: associated ? "in-use" : "unused",
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      allocationId: address.AllocationId ?? null,
      publicIp: address.PublicIp ?? null,
      privateIpAddress: address.PrivateIpAddress ?? null,
      associationId: address.AssociationId ?? null,
      instanceId: address.InstanceId ?? null,
      networkInterfaceId: address.NetworkInterfaceId ?? null,
      networkInterfaceOwnerId: address.NetworkInterfaceOwnerId ?? null,
      domain: address.Domain ?? null,
      publicIpv4Pool: address.PublicIpv4Pool ?? null,
      networkBorderGroup: address.NetworkBorderGroup ?? null,
      carrierIp: address.CarrierIp ?? null,
    },
  };
}
