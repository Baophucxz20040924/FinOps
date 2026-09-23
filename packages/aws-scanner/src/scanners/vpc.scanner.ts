import {
  EC2Client,
  DescribeVpcsCommand,
  type DescribeVpcsCommandOutput,
  type Vpc,
  DescribeSubnetsCommand,
  type DescribeSubnetsCommandOutput,
  type Subnet,
  DescribeSecurityGroupsCommand,
  type DescribeSecurityGroupsCommandOutput,
  type SecurityGroup,
  DescribeRouteTablesCommand,
  type DescribeRouteTablesCommandOutput,
  type RouteTable,
  DescribeInternetGatewaysCommand,
  type DescribeInternetGatewaysCommandOutput,
  type InternetGateway,
  DescribeNatGatewaysCommand,
  type DescribeNatGatewaysCommandOutput,
  type NatGateway,
  DescribeAddressesCommand,
  type DescribeAddressesCommandOutput,
  type Address,
} from "@aws-sdk/client-ec2";
import type { NormalizedResource } from "@infra-explorer/domain";
import type {
  RawDiscoveryResult,
  ResourceScanner,
  ScanContext,
  ScannerError,
} from "../types";
import { collectPaginated, toScannerError } from "../scan-helpers";
import type { NormalizeContext } from "../normalize/context";
import {
  normalizeElasticIp,
  normalizeInternetGateway,
  normalizeNatGateway,
  normalizeRouteTable,
  normalizeSecurityGroup,
  normalizeSubnet,
  normalizeVpc,
} from "../normalize/vpc.normalize";

/**
 * Discovers the VPC service family (vpc, subnet, security-group, route-table,
 * internet-gateway, nat-gateway, elastic-ip) in one pass. Because a single
 * invocation spans seven independent AWS APIs, each describe is wrapped in its
 * own try/catch (via `discover`) so a throttle on one sub-type does not drop
 * resources already collected from the others — preserving the partial-failure
 * contract at sub-resource granularity. All errors are attributed to the "VPC"
 * service bucket.
 */
export class VpcScanner implements ResourceScanner {
  readonly service = "VPC";
  readonly scope = "REGIONAL" as const;

  async scan(ctx: ScanContext): Promise<RawDiscoveryResult> {
    const client = new EC2Client({
      region: ctx.region,
      credentials: ctx.target.credentials,
    });
    const nctx: NormalizeContext = {
      region: ctx.region,
      accountId: ctx.target.accountId,
      awsAccountId: ctx.target.awsAccountId,
    };
    const resources: NormalizedResource[] = [];
    const errors: ScannerError[] = [];

    try {
      // --- Token-paginated describes ---
      await this.discover<DescribeVpcsCommandOutput, Vpc>(
        ctx,
        resources,
        errors,
        async (token) => {
          const r = await client.send(
            new DescribeVpcsCommand({ NextToken: token, MaxResults: 1000 }),
          );
          return { page: r, nextToken: r.NextToken };
        },
        (p) => p.Vpcs,
        (v) => normalizeVpc(v, nctx),
      );

      await this.discover<DescribeSubnetsCommandOutput, Subnet>(
        ctx,
        resources,
        errors,
        async (token) => {
          const r = await client.send(
            new DescribeSubnetsCommand({ NextToken: token, MaxResults: 1000 }),
          );
          return { page: r, nextToken: r.NextToken };
        },
        (p) => p.Subnets,
        (s) => normalizeSubnet(s, nctx),
      );

      await this.discover<DescribeSecurityGroupsCommandOutput, SecurityGroup>(
        ctx,
        resources,
        errors,
        async (token) => {
          const r = await client.send(
            new DescribeSecurityGroupsCommand({
              NextToken: token,
              MaxResults: 1000,
            }),
          );
          return { page: r, nextToken: r.NextToken };
        },
        (p) => p.SecurityGroups,
        (g) => normalizeSecurityGroup(g, nctx),
      );

      // DescribeRouteTables MaxResults ceiling is 100 (1000 is rejected).
      await this.discover<DescribeRouteTablesCommandOutput, RouteTable>(
        ctx,
        resources,
        errors,
        async (token) => {
          const r = await client.send(
            new DescribeRouteTablesCommand({
              NextToken: token,
              MaxResults: 100,
            }),
          );
          return { page: r, nextToken: r.NextToken };
        },
        (p) => p.RouteTables,
        (rt) => normalizeRouteTable(rt, nctx),
      );

      await this.discover<DescribeInternetGatewaysCommandOutput, InternetGateway>(
        ctx,
        resources,
        errors,
        async (token) => {
          const r = await client.send(
            new DescribeInternetGatewaysCommand({
              NextToken: token,
              MaxResults: 1000,
            }),
          );
          return { page: r, nextToken: r.NextToken };
        },
        (p) => p.InternetGateways,
        (igw) => normalizeInternetGateway(igw, nctx),
      );

      await this.discover<DescribeNatGatewaysCommandOutput, NatGateway>(
        ctx,
        resources,
        errors,
        async (token) => {
          const r = await client.send(
            new DescribeNatGatewaysCommand({
              NextToken: token,
              MaxResults: 1000,
            }),
          );
          return { page: r, nextToken: r.NextToken };
        },
        (p) => p.NatGateways,
        (nat) => normalizeNatGateway(nat, nctx),
      );

      // DescribeAddresses is NOT token-paginated: send no token and always
      // return nextToken undefined, so the pagination loop makes exactly one
      // call (and the recorder counts exactly one API call).
      await this.discover<DescribeAddressesCommandOutput, Address>(
        ctx,
        resources,
        errors,
        async () => {
          const r = await client.send(new DescribeAddressesCommand({}));
          return { page: r, nextToken: undefined };
        },
        (p) => p.Addresses,
        (a) => normalizeElasticIp(a, nctx),
      );

      return { resources, errors };
    } finally {
      client.destroy();
    }
  }

  /**
   * Runs one paginated describe and normalizes its items, isolating failures so
   * a throttle on this sub-type only records an error and leaves already
   * collected resources intact.
   */
  private async discover<TPage, TItem>(
    ctx: ScanContext,
    out: NormalizedResource[],
    errors: ScannerError[],
    fetchPage: (
      token: string | undefined,
    ) => Promise<{ page: TPage; nextToken: string | undefined }>,
    extract: (page: TPage) => TItem[] | undefined,
    normalize: (item: TItem) => NormalizedResource | null,
  ): Promise<void> {
    try {
      const items = await collectPaginated<TPage, TItem>(
        ctx,
        this.service,
        fetchPage,
        extract,
      );
      for (const item of items) {
        const normalized = normalize(item);
        if (normalized !== null) out.push(normalized);
      }
    } catch (err) {
      ctx.logger.warn(
        { err, service: this.service, region: ctx.region },
        "VPC sub-resource scan failed",
      );
      errors.push(toScannerError(this.service, ctx.region, err));
    }
  }
}
