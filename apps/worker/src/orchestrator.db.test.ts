import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
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
  DescribeInstancesCommand,
  DescribeVolumesCommand,
} from "@aws-sdk/client-ec2";
import {
  createDb,
  closeDb,
  type Database,
  accounts,
  scans,
  resources,
  relationships,
  resolveTestDatabaseUrl,
  ScansRepository,
} from "@infra-explorer/db";
import { createLogger } from "@infra-explorer/shared";
import type { Pool } from "pg";
import { ScanOrchestrator } from "./orchestrator";

// TRUNCATES tables → runs against the dedicated <name>_test database, never the app DB.
const testDbUrl = resolveTestDatabaseUrl();
const hasDb = Boolean(testDbUrl);
const ec2Mock = mockClient(EC2Client);
const AWS_ID = "210000000001"; // distinct from the seed account

describe.skipIf(!hasDb)("ScanOrchestrator (DB, mocked AWS)", () => {
  let db: Database;
  let pool: Pool;
  let accountId: string;

  const logger = createLogger({ level: "silent" });

  async function cleanup(): Promise<void> {
    const accs = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(sql`aws_account_id = ${AWS_ID}`);
    for (const a of accs) {
      await db.delete(relationships).where(
        sql`source_resource_id in (select id from resources where account_id = ${a.id})`,
      );
      await db.delete(resources).where(sql`account_id = ${a.id}`);
      await db.delete(scans).where(sql`account_id = ${a.id}`);
    }
    await db.delete(accounts).where(sql`aws_account_id = ${AWS_ID}`);
  }

  beforeAll(() => {
    const conn = createDb({ connectionString: testDbUrl });
    db = conn.db;
    pool = conn.pool;
  });
  afterAll(async () => {
    await cleanup();
    await closeDb(pool);
  });

  beforeEach(async () => {
    ec2Mock.reset();
    await cleanup();
    const [acc] = await db
      .insert(accounts)
      .values({
        awsAccountId: AWS_ID,
        displayName: "Orchestrator Test",
        roleArn: `arn:aws:iam::${AWS_ID}:role/InfraExplorerReadOnly`,
        externalId: "ie-orch0123456789",
        status: "ACTIVE",
        enabledRegions: ["us-west-2"],
      })
      .returning();
    accountId = acc!.id;
  });

  function stubHealthyTopology(): void {
    ec2Mock.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-1", State: "available" }] });
    ec2Mock.on(DescribeSubnetsCommand).resolves({ Subnets: [{ SubnetId: "subnet-1", VpcId: "vpc-1", State: "available" }] });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [{ GroupId: "sg-1", GroupName: "web", VpcId: "vpc-1" }] });
    ec2Mock.on(DescribeRouteTablesCommand).resolves({ RouteTables: [] });
    ec2Mock.on(DescribeInternetGatewaysCommand).resolves({ InternetGateways: [] });
    ec2Mock.on(DescribeNatGatewaysCommand).resolves({ NatGateways: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: "i-1",
              State: { Name: "running" },
              VpcId: "vpc-1",
              SubnetId: "subnet-1",
              SecurityGroups: [{ GroupId: "sg-1" }],
              BlockDeviceMappings: [{ Ebs: { VolumeId: "vol-1" } }],
              Tags: [{ Key: "Name", Value: "api-prod" }],
            },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeVolumesCommand).resolves({
      Volumes: [
        { VolumeId: "vol-1", State: "in-use", Size: 100, Attachments: [{ InstanceId: "i-1" }] },
      ],
    });
  }

  async function scanCount(): Promise<{ resources: number; edges: number }> {
    const r = await db.execute(
      sql`select count(*)::int as n from resources where account_id = ${accountId} and is_deleted = false`,
    );
    const e = await db.execute(
      sql`select count(*)::int as n from relationships rel where exists (select 1 from resources s where s.id = rel.source_resource_id and s.account_id = ${accountId})`,
    );
    return { resources: Number(r.rows[0]!.n), edges: Number(e.rows[0]!.n) };
  }

  it("runs the full pipeline: discover -> persist -> relate -> SUCCESS", async () => {
    stubHealthyTopology();
    const scansRepo = new ScansRepository(db);
    const scan = await scansRepo.create({
      accountId,
      regions: ["us-west-2"],
      triggeredBy: "test",
    });

    await new ScanOrchestrator({ db, logger }).run(scan.id);

    const finished = await scansRepo.getById(scan.id);
    expect(finished!.status).toBe("SUCCESS");
    expect(finished!.serviceResults.map((r) => r.service).sort()).toEqual([
      "EBS",
      "EC2",
      "VPC",
    ]);
    expect(finished!.serviceResults.every((r) => r.status === "OK")).toBe(true);
    expect(finished!.stats.resourcesDiscovered).toBe(5); // vpc, subnet, sg, instance, volume

    const counts = await scanCount();
    expect(counts.resources).toBe(5);
    // instance->subnet, instance->vpc, instance->sg, sg->vpc, subnet->vpc, volume->instance
    expect(counts.edges).toBeGreaterThanOrEqual(6);
  });

  it("records PARTIAL_SUCCESS when a scanner scope fails, without tombstoning it", async () => {
    stubHealthyTopology();
    // EC2 DescribeInstances hard-fails (non-retryable) → EC2 scope FAILED.
    ec2Mock
      .on(DescribeInstancesCommand)
      .rejects(Object.assign(new Error("denied"), { name: "AccessDenied" }));

    const scansRepo = new ScansRepository(db);
    const scan = await scansRepo.create({
      accountId,
      regions: ["us-west-2"],
      triggeredBy: "test",
    });
    await new ScanOrchestrator({ db, logger }).run(scan.id);

    const finished = await scansRepo.getById(scan.id);
    expect(finished!.status).toBe("PARTIAL_SUCCESS");
    const ec2Result = finished!.serviceResults.find((r) => r.service === "EC2");
    expect(ec2Result!.status).toBe("FAILED");
    // VPC + EBS still discovered
    const counts = await scanCount();
    expect(counts.resources).toBeGreaterThanOrEqual(4); // vpc, subnet, sg, volume
  });
});
