import {
  EC2Client,
  DescribeVolumesCommand,
  type DescribeVolumesCommandOutput,
  type Volume,
} from "@aws-sdk/client-ec2";
import type { NormalizedResource } from "@infra-explorer/domain";
import type {
  RawDiscoveryResult,
  ResourceScanner,
  ScanContext,
} from "../types";
import { collectPaginated, toScannerError } from "../scan-helpers";
import { normalizeVolume } from "../normalize/ebs.normalize";

export class EbsScanner implements ResourceScanner {
  readonly service = "EBS";
  readonly scope = "REGIONAL" as const;

  async scan(ctx: ScanContext): Promise<RawDiscoveryResult> {
    const client = new EC2Client({
      region: ctx.region,
      credentials: ctx.target.credentials,
    });

    try {
      const volumes = await collectPaginated<
        DescribeVolumesCommandOutput,
        Volume
      >(
        ctx,
        this.service,
        async (token) => {
          const res = await client.send(
            new DescribeVolumesCommand({ NextToken: token, MaxResults: 500 }),
          );
          return { page: res, nextToken: res.NextToken };
        },
        (page) => page.Volumes ?? [],
      );

      const nctx = {
        region: ctx.region,
        accountId: ctx.target.accountId,
        awsAccountId: ctx.target.awsAccountId,
      };
      const resources = volumes
        .map((v) => normalizeVolume(v, nctx))
        .filter((r): r is NormalizedResource => r !== null);

      return { resources, errors: [] };
    } catch (err) {
      ctx.logger.warn(
        { err, service: this.service, region: ctx.region },
        "EBS scan failed",
      );
      return {
        resources: [],
        errors: [toScannerError(this.service, ctx.region, err)],
      };
    } finally {
      client.destroy();
    }
  }
}
