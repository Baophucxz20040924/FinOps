import { createDb, closeDb } from "./client";
import { accounts } from "./schema/accounts";
import { scans } from "./schema/scans";
import { resources, type NewResourceRow } from "./schema/resources";
import { relationships } from "./schema/relationships";
import { eq } from "drizzle-orm";

/**
 * Seeds a realistic single-account, single-region topology so the UI renders
 * without a live AWS scan. Idempotent: it deletes and recreates the demo
 * account's data on each run. NOT used in production — dev/demo only.
 *
 * Run: pnpm --filter @infra-explorer/db db:seed   (needs DATABASE_URL)
 */

const DEMO_AWS_ACCOUNT_ID = "123456789012";
const REGION = "us-west-2";

async function main(): Promise<void> {
  const { db, pool } = createDb();
  try {
    // --- Reset the demo account (cascade-safe order) ---
    const existing = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.awsAccountId, DEMO_AWS_ACCOUNT_ID));
    for (const a of existing) {
      const rs = await db
        .select({ id: resources.id })
        .from(resources)
        .where(eq(resources.accountId, a.id));
      for (const r of rs) {
        await db
          .delete(relationships)
          .where(eq(relationships.sourceResourceId, r.id));
      }
      await db.delete(resources).where(eq(resources.accountId, a.id));
      await db.delete(scans).where(eq(scans.accountId, a.id));
    }
    await db
      .delete(accounts)
      .where(eq(accounts.awsAccountId, DEMO_AWS_ACCOUNT_ID));

    // --- Account + scan ---
    const [account] = await db
      .insert(accounts)
      .values({
        awsAccountId: DEMO_AWS_ACCOUNT_ID,
        displayName: "Production (demo)",
        roleArn: `arn:aws:iam::${DEMO_AWS_ACCOUNT_ID}:role/InfraExplorerReadOnly`,
        externalId: "ie-demo0123456789",
        status: "ACTIVE",
        enabledRegions: [REGION],
      })
      .returning();
    const accountId = account!.id;

    const [scan] = await db
      .insert(scans)
      .values({
        accountId,
        regions: [REGION],
        status: "SUCCESS",
        triggeredBy: "seed",
        serviceResults: [
          { service: "EC2", region: REGION, status: "OK", resourceCount: 3 },
          { service: "EBS", region: REGION, status: "OK", resourceCount: 3 },
          { service: "VPC", region: REGION, status: "OK", resourceCount: 8 },
        ],
        stats: { resourcesDiscovered: 14, findingsGenerated: 0 },
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .returning();
    const scanId = scan!.id;

    // --- Resources ---
    const base = {
      accountId,
      region: REGION,
      lastScanId: scanId,
      environment: "prod",
    };
    const rows: NewResourceRow[] = [
      // networking
      { ...base, service: "VPC", type: "vpc", externalId: "vpc-1", name: "prod-vpc", state: "available", tags: { Name: "prod-vpc", Environment: "prod" }, metadata: { cidrBlock: "10.0.0.0/16" } },
      { ...base, service: "VPC", type: "subnet", externalId: "subnet-a", name: "prod-subnet-a", state: "available", tags: { Name: "prod-subnet-a" }, metadata: { vpcId: "vpc-1", availabilityZone: "us-west-2a", cidrBlock: "10.0.1.0/24" } },
      { ...base, service: "VPC", type: "subnet", externalId: "subnet-b", name: "prod-subnet-b", state: "available", tags: { Name: "prod-subnet-b" }, metadata: { vpcId: "vpc-1", availabilityZone: "us-west-2b", cidrBlock: "10.0.2.0/24" } },
      { ...base, service: "VPC", type: "security-group", externalId: "sg-web", name: "web-sg", state: null, tags: { Name: "web-sg" }, metadata: { vpcId: "vpc-1", groupName: "web-sg", ingressRuleCount: 2 } },
      { ...base, service: "VPC", type: "security-group", externalId: "sg-db", name: "db-sg", state: null, tags: { Name: "db-sg" }, metadata: { vpcId: "vpc-1", groupName: "db-sg", ingressRuleCount: 1 } },
      { ...base, service: "VPC", type: "internet-gateway", externalId: "igw-1", name: "prod-igw", state: "attached", tags: { Name: "prod-igw" }, metadata: { attachedVpcId: "vpc-1" } },
      { ...base, service: "VPC", type: "nat-gateway", externalId: "nat-1", name: "prod-nat", state: "available", tags: { Name: "prod-nat" }, metadata: { vpcId: "vpc-1", subnetId: "subnet-a", eipRefs: ["eipalloc-1"] } },
      { ...base, service: "VPC", type: "elastic-ip", externalId: "eipalloc-1", name: "nat-eip", state: "in-use", tags: {}, metadata: { allocationId: "eipalloc-1", publicIp: "52.10.0.1" } },
      { ...base, service: "VPC", type: "elastic-ip", externalId: "eipalloc-2", name: "orphan-eip", state: "unused", tags: {}, metadata: { allocationId: "eipalloc-2", publicIp: "52.10.0.2" } },
      // compute
      { ...base, service: "EC2", type: "instance", externalId: "i-web1", name: "api-prod-1", state: "running", tags: { Name: "api-prod-1", Environment: "prod" }, metadata: { instanceType: "t3.large", vpcId: "vpc-1", subnetId: "subnet-a", securityGroupIds: ["sg-web"], hasPublicIp: true } },
      { ...base, service: "EC2", type: "instance", externalId: "i-web2", name: "api-prod-2", state: "running", tags: { Name: "api-prod-2", Environment: "prod" }, metadata: { instanceType: "t3.large", vpcId: "vpc-1", subnetId: "subnet-b", securityGroupIds: ["sg-web"], hasPublicIp: false } },
      { ...base, service: "EC2", type: "instance", externalId: "i-worker", name: "api-worker", state: "stopped", tags: { Name: "api-worker", Environment: "prod" }, metadata: { instanceType: "t3.medium", vpcId: "vpc-1", subnetId: "subnet-a", securityGroupIds: ["sg-db"] } },
      // storage
      { ...base, service: "EBS", type: "volume", externalId: "vol-web1", name: "api-prod-1-root", state: "in-use", tags: {}, metadata: { sizeGiB: 100, volumeType: "gp3", attachedInstanceIds: ["i-web1"] } },
      { ...base, service: "EBS", type: "volume", externalId: "vol-web2", name: "api-prod-2-root", state: "in-use", tags: {}, metadata: { sizeGiB: 100, volumeType: "gp3", attachedInstanceIds: ["i-web2"] } },
      { ...base, service: "EBS", type: "volume", externalId: "vol-orphan", name: "old-data", state: "available", tags: {}, metadata: { sizeGiB: 50, volumeType: "gp2", attachedInstanceIds: [] } },
    ];
    const inserted = await db.insert(resources).values(rows).returning({
      id: resources.id,
      externalId: resources.externalId,
    });
    const idByExt = new Map(inserted.map((r) => [r.externalId, r.id]));

    // --- Relationships (source ext, target ext, type) ---
    const edges: Array<[string, string, string]> = [
      ["subnet-a", "vpc-1", "MEMBER_OF"],
      ["subnet-b", "vpc-1", "MEMBER_OF"],
      ["sg-web", "vpc-1", "IN_VPC"],
      ["sg-db", "vpc-1", "IN_VPC"],
      ["igw-1", "vpc-1", "IN_VPC"],
      ["nat-1", "vpc-1", "IN_VPC"],
      ["nat-1", "subnet-a", "IN_SUBNET"],
      ["nat-1", "eipalloc-1", "ROUTES_TO"],
      ["i-web1", "subnet-a", "IN_SUBNET"],
      ["i-web1", "vpc-1", "IN_VPC"],
      ["i-web1", "sg-web", "USES_SG"],
      ["i-web2", "subnet-b", "IN_SUBNET"],
      ["i-web2", "vpc-1", "IN_VPC"],
      ["i-web2", "sg-web", "USES_SG"],
      ["i-worker", "subnet-a", "IN_SUBNET"],
      ["i-worker", "vpc-1", "IN_VPC"],
      ["i-worker", "sg-db", "USES_SG"],
      ["vol-web1", "i-web1", "ATTACHED_TO"],
      ["vol-web2", "i-web2", "ATTACHED_TO"],
    ];
    await db.insert(relationships).values(
      edges.map(([src, tgt, type]) => ({
        sourceResourceId: idByExt.get(src)!,
        targetResourceId: idByExt.get(tgt)!,
        type: type as never,
        confidence: "VERIFIED" as const,
        discoveredInScanId: scanId,
      })),
    );

    // eslint-disable-next-line no-console
    console.log(
      `Seeded account ${accountId} (${DEMO_AWS_ACCOUNT_ID}) with ${rows.length} resources and ${edges.length} relationships.`,
    );
    // eslint-disable-next-line no-console
    console.log(`accountId for the UI: ${accountId}`);
  } finally {
    await closeDb(pool);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed", err);
  process.exit(1);
});
