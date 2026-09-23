import type { Volume } from "@aws-sdk/client-ec2";
import type { NormalizedResource } from "@infra-explorer/domain";
import { ec2Arn } from "../arn";
import { deriveEnvironment, deriveName, tagListToRecord } from "./tags";
import { definedStrings, type NormalizeContext } from "./context";

/**
 * Maps an EBS volume to the normalized model. State is the raw AWS state:
 * "available" means the volume is unattached (the UNATTACHED_EBS rule keys on
 * this). Attached instance ids are kept in metadata for the ATTACHED_TO edge.
 */
export function normalizeVolume(
  volume: Volume,
  ctx: NormalizeContext,
): NormalizedResource | null {
  const id = volume.VolumeId;
  if (!id) return null;

  const tags = tagListToRecord(volume.Tags);
  const attachedInstanceIds = definedStrings(
    (volume.Attachments ?? []).map((a) => a.InstanceId),
  );

  return {
    arn: ec2Arn(ctx.region, ctx.awsAccountId, `volume/${id}`),
    externalId: id,
    accountId: ctx.accountId,
    region: ctx.region,
    service: "EBS",
    type: "volume",
    name: deriveName(tags, id),
    state: volume.State ?? null,
    environment: deriveEnvironment(tags),
    tags,
    metadata: {
      sizeGiB: volume.Size ?? null,
      volumeType: volume.VolumeType ?? null,
      iops: volume.Iops ?? null,
      throughput: volume.Throughput ?? null,
      encrypted: volume.Encrypted ?? null,
      availabilityZone: volume.AvailabilityZone ?? null,
      snapshotId: volume.SnapshotId ?? null,
      createTime: volume.CreateTime?.toISOString() ?? null,
      attachedInstanceIds,
    },
  };
}
