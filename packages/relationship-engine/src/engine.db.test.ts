import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  closeDb,
  resolveTestDatabaseUrl,
  type Database,
  accounts,
  scans,
  resources,
  relationships,
} from "@infra-explorer/db";
import { createLogger } from "@infra-explorer/shared";
import type { Pool } from "pg";
import { createRelationshipEngine } from "./engine";

/**
 * DB-required engine tests. These TRUNCATE tables, so they run against a
 * dedicated <name>_test database (never the app DB). Skipped unless DATABASE_URL
 * is set; create + migrate the *_test database first (README testing section).
 */
const testDbUrl = resolveTestDatabaseUrl();
const hasDb = Boolean(testDbUrl);

describe.skipIf(!hasDb)("relationship engine (DB)", () => {
  let db: Database;
  let pool: Pool;
  let accountId: string;
  let scanA: string;
  let scanB: string;
  const engine = () =>
    createRelationshipEngine({ db, logger: createLogger({ level: "silent" }) });

  async function insertResource(
    externalId: string,
    service: string,
    type: string,
    metadata: Record<string, unknown>,
    scanId: string,
    region = "us-west-2",
  ): Promise<string> {
    const [row] = await db
      .insert(resources)
      .values({
        accountId,
        region,
        externalId,
        service,
        type,
        metadata,
        lastScanId: scanId,
      })
      .returning({ id: resources.id });
    return row!.id;
  }

  beforeAll(() => {
    const conn = createDb({ connectionString: testDbUrl });
    db = conn.db;
    pool = conn.pool;
  });
  afterAll(async () => {
    await closeDb(pool);
  });

  beforeEach(async () => {
    await db.delete(relationships);
    await db.delete(resources);
    await db.delete(scans);
    await db.delete(accounts);
    const [acc] = await db
      .insert(accounts)
      .values({
        awsAccountId: "123456789012",
        displayName: "Test",
        roleArn: "arn:aws:iam::123456789012:role/InfraExplorerReadOnly",
        externalId: "ie-test123456789",
        enabledRegions: ["us-west-2", "eu-west-1"],
      })
      .returning();
    accountId = acc!.id;
    const s = await db
      .insert(scans)
      .values([
        { accountId, regions: ["us-west-2"], triggeredBy: "test" },
        { accountId, regions: ["us-west-2"], triggeredBy: "test" },
      ])
      .returning();
    scanA = s[0]!.id;
    scanB = s[1]!.id;
  });

  it("builds edges and is idempotent (created_at preserved across rebuilds)", async () => {
    await insertResource("vpc-1", "VPC", "vpc", {}, scanA);
    await insertResource("i-1", "EC2", "instance", { vpcId: "vpc-1" }, scanA);

    const r1 = await engine().build(scanA);
    expect(r1.edgesUpserted).toBe(1);
    const first = await db.execute(
      sql`select id, created_at, discovered_in_scan_id from relationships`,
    );
    expect(first.rows).toHaveLength(1);

    const r2 = await engine().build(scanB);
    const second = await db.execute(
      sql`select id, created_at, discovered_in_scan_id from relationships`,
    );
    expect(second.rows).toHaveLength(1); // no duplicate
    expect(second.rows[0]!.id).toBe(first.rows[0]!.id); // same edge row
    expect(String(second.rows[0]!.created_at)).toBe(
      String(first.rows[0]!.created_at),
    ); // first-seen preserved
    expect(second.rows[0]!.discovered_in_scan_id).toBe(scanB); // refreshed
    expect(r2.edgesPruned).toBe(0);
  });

  it("prunes an edge whose endpoint was soft-deleted, keeps edges in un-rescanned regions", async () => {
    // us-west-2: instance -> vpc ; eu-west-1: instance -> vpc
    await insertResource("vpc-w", "VPC", "vpc", {}, scanA, "us-west-2");
    const iw = await insertResource(
      "i-w",
      "EC2",
      "instance",
      { vpcId: "vpc-w" },
      scanA,
      "us-west-2",
    );
    await insertResource("vpc-e", "VPC", "vpc", {}, scanA, "eu-west-1");
    await insertResource(
      "i-e",
      "EC2",
      "instance",
      { vpcId: "vpc-e" },
      scanA,
      "eu-west-1",
    );
    await engine().build(scanA);
    expect(
      (await db.execute(sql`select count(*)::int as n from relationships`))
        .rows[0]!.n,
    ).toBe(2);

    // soft-delete the us-west-2 instance (as a later scan would), rebuild
    await db
      .update(resources)
      .set({ isDeleted: true })
      .where(sql`id = ${iw}`);
    const res = await engine().build(scanB);

    const rows = await db.execute(
      sql`select source_resource_id from relationships`,
    );
    expect(rows.rows).toHaveLength(1); // us-west-2 edge pruned
    expect(rows.rows[0]!.source_resource_id).not.toBe(iw);
    expect(res.edgesPruned).toBe(1); // eu-west-1 edge survived (re-derived)
  });

  it("skips the prune when the live set is empty (graph-protection guard)", async () => {
    await insertResource("vpc-1", "VPC", "vpc", {}, scanA);
    await insertResource("i-1", "EC2", "instance", { vpcId: "vpc-1" }, scanA);
    await engine().build(scanA);

    // soft-delete everything, then rebuild
    await db.update(resources).set({ isDeleted: true });
    const res = await engine().build(scanB);
    expect(res.pruneSkipped).toBe(true);
    expect(
      (await db.execute(sql`select count(*)::int as n from relationships`))
        .rows[0]!.n,
    ).toBe(1); // untouched
  });

  it("cascade-deletes edges when a resource is hard-deleted", async () => {
    const vpc = await insertResource("vpc-1", "VPC", "vpc", {}, scanA);
    await insertResource("i-1", "EC2", "instance", { vpcId: "vpc-1" }, scanA);
    await engine().build(scanA);
    await db.delete(resources).where(sql`id = ${vpc}`);
    expect(
      (await db.execute(sql`select count(*)::int as n from relationships`))
        .rows[0]!.n,
    ).toBe(0);
  });
});
