import {
  EC2Client,
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  type Instance,
} from "@aws-sdk/client-ec2";
import type { NormalizedResource } from "@infra-explorer/domain";
import type {
  RawDiscoveryResult,
  ResourceScanner,
  ScanContext,
} from "../types";
import { collectPaginated, toScannerError } from "../scan-helpers";
import { normalizeInstance } from "../normalize/ec2.normalize";

export class Ec2Scanner implements ResourceScanner {
  readonly service = "EC2";
  readonly scope = "REGIONAL" as const;

  async scan(ctx: ScanContext): Promise<RawDiscoveryResult> {
    const client = new EC2Client({
      region: ctx.region,
      credentials: ctx.target.credentials,
    });

    try {
      const instances = await collectPaginated<
        DescribeInstancesCommandOutput,
        Instance
      >(
        ctx,
        this.service,
        async (token) => {
          const res = await client.send(
            new DescribeInstancesCommand({ NextToken: token, MaxResults: 1000 }),
          );
          return { page: res, nextToken: res.NextToken };
        },
        (page) => (page.Reservations ?? []).flatMap((r) => r.Instances ?? []),
      );

      const nctx = {
        region: ctx.region,
        accountId: ctx.target.accountId,
        awsAccountId: ctx.target.awsAccountId,
      };
      const resources = instances
        .map((i) => normalizeInstance(i, nctx))
        .filter((r): r is NormalizedResource => r !== null);

      return { resources, errors: [] };
    } catch (err) {
      ctx.logger.warn(
        { err, service: this.service, region: ctx.region },
        "EC2 scan failed",
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
