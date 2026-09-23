import type { Instance } from "@aws-sdk/client-ec2";
import type { NormalizedResource } from "@infra-explorer/domain";
import { ec2Arn } from "../arn";
import { deriveEnvironment, deriveName, tagListToRecord } from "./tags";
import { definedStrings, type NormalizeContext } from "./context";

/**
 * Maps an EC2 instance to the normalized model. Relationship-relevant ids
 * (subnet, SGs, volumes, IAM profile) are stored in metadata so the
 * relationship engine can resolve edges after all scanners complete.
 */
export function normalizeInstance(
  instance: Instance,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = instance.InstanceId;
  if (!id) return null;

  const tags = tagListToRecord(instance.Tags);
  const securityGroupIds = definedStrings(
    (instance.SecurityGroups ?? []).map((g) => g.GroupId),
  );
  const volumeIds = definedStrings(
    (instance.BlockDeviceMappings ?? []).map((b) => b.Ebs?.VolumeId),
  );

  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `instance/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "EC2",
    type: "instance",
    name: deriveName(tags, id),
    state: instance.State?.Name ?? null,
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      instanceType: instance.InstanceType ?? null,
      privateIpAddress: instance.PrivateIpAddress ?? null,
      publicIpAddress: instance.PublicIpAddress ?? null,
      hasPublicIp: Boolean(instance.PublicIpAddress),
      availabilityZone: instance.Placement?.AvailabilityZone ?? null,
      vpcId: instance.VpcId ?? null,
      subnetId: instance.SubnetId ?? null,
      imageId: instance.ImageId ?? null,
      architecture: instance.Architecture ?? null,
      launchTime: instance.LaunchTime?.toISOString() ?? null,
      keyName: instance.KeyName ?? null,
      securityGroupIds,
      volumeIds,
      iamInstanceProfileArn: instance.IamInstanceProfile?.Arn ?? null,
    },
  };
}
