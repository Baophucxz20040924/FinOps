import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { NormalizedResource } from "@infra-explorer/domain";
import { createDb, closeDb, type Database } from "../client";
import { accounts } from "../schema/accounts";
import { scans } from "../schema/scans";
import { resources } from "../schema/resources";
import { relationships } from "../schema/relationships";
import { ResourcesRepository, resourceKey } from "./resources.repository";
import type { Pool } from "pg";

/**
 * DB-required behavioral tests. Skipped unless DATABASE_URL is set (CI must not
 * need Postgres). Run locally with:
 *   pnpm db:up && DATABASE_URL=postgresql://infra:infra@localhost:5432/infra_explorer pnpm --filter @infra-explorer/db test
 * Assumes migrations have been applied to that database.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("ResourcesRepository (DB)", () => {
  let db: Database;
  let pool: Pool;
  let repo: ResourcesRepository;
  let accountId: string;
  let scanA: string;
  let scanB: string;

  function res(overrides: Partial<NormalizedResource>): NormalizedResource {
    return {
      arn: null,
      externalId: "i-1",
      accountId,
      region: "us-west-2",
      service: "EC2",
      type: "instance",
      name: "n",
      state: "running",
      environment: null,
      tags: {},
      metadata: {},
      ...overrides,
    };
  }

  beforeAll(() => {
    const conn = createDb();
    db = conn.db;
    pool = conn.pool;
    repo = new ResourcesRepository(db);
  });

  afterAll(async () => {
    await closeDb(pool);
  });

  beforeEach(async () => {
    // Clean slate (respect FK order: relationships -> resources -> scans -> accounts).
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
    const inserted = await db
      .insert(scans)
      .values([
        { accountId, regions: ["us-west-2"], triggeredBy: "test" },
        { accountId, regions: ["us-west-2"], triggeredBy: "test" },
      ])
      .returning();
    scanA = inserted[0]!.id;
    scanB = inserted[1]!.id;
  });

  it("upserts idempotently: re-scan produces no duplicates and preserves first_seen_at", async () => {
    const map1 = await repo.bulkUpsert(scanA, [res({ externalId: "i-1" })]);
    const id1 = map1.get(
      resourceKey({ accountId, region: "us-west-2", service: "EC2", externalId: "i-1" }),
    );
    const before = await db.execute(
      sql`select id, first_seen_at, last_seen_at, last_scan_id from resources where external_id = 'i-1'`,
    );

    const map2 = await repo.bulkUpsert(scanB, [
      res({ externalId: "i-1", state: "stopped" }),
    ]);
    const id2 = map2.get(
      resourceKey({ accountId, region: "us-west-2", service: "EC2", externalId: "i-1" }),
    );

    expect(id2).toBe(id1); // same row
    const rows = await db.execute(
      sql`select id, state, first_seen_at, last_scan_id, is_deleted from resources where external_id = 'i-1'`,
    );
    expect(rows.rows).toHaveLength(1); // no duplicate
    expect(rows.rows[0]!.state).toBe("stopped"); // updated
    expect(rows.rows[0]!.last_scan_id).toBe(scanB);
    expect(rows.rows[0]!.is_deleted).toBe(false);
    // first_seen_at preserved
    expect(String(rows.rows[0]!.first_seen_at)).toBe(
      String(before.rows[0]!.first_seen_at),
    );
  });

  it("soft-deletes absent rows only within OK scopes; never a failed service", async () => {
    // Seed two services in us-west-2 via scanA.
    await repo.bulkUpsert(scanA, [
      res({ externalId: "i-1", service: "EC2" }),
      res({ externalId: "vol-1", service: "EBS", type: "volume", state: "available" }),
    ]);

    // scanB re-observes EC2 (i-1 gone), EBS scanner FAILED (not in OK scopes).
    await repo.persistScan({
      accountId,
      scanId: scanB,
      resources: [res({ externalId: "i-2", service: "EC2" })],
      scannedScopes: [{ service: "EC2", region: "us-west-2" }], // EBS omitted → failed
    });

    const rows = await db.execute(
      sql`select external_id, is_deleted from resources order by external_id`,
    );
    const map = Object.fromEntries(
      rows.rows.map((r) => [r.external_id, r.is_deleted]),
    );
    expect(map["i-1"]).toBe(true); // absent in an OK scope → tombstoned
    expect(map["i-2"]).toBe(false); // freshly seen
    expect(map["vol-1"]).toBe(false); // EBS failed → must NOT be tombstoned
  });

  it("does not tombstone rows in a region the scan did not cover", async () => {
    await repo.bulkUpsert(scanA, [
      res({ externalId: "i-west", region: "us-west-2" }),
      res({ externalId: "i-east", region: "eu-west-1" }),
    ]);
    await repo.persistScan({
      accountId,
      scanId: scanB,
      resources: [], // nothing seen in us-west-2 this time
      scannedScopes: [{ service: "EC2", region: "us-west-2" }],
    });
    const rows = await db.execute(
      sql`select external_id, is_deleted from resources order by external_id`,
    );
    const map = Object.fromEntries(
      rows.rows.map((r) => [r.external_id, r.is_deleted]),
    );
    expect(map["i-west"]).toBe(true); // OK scope, absent → tombstoned
    expect(map["i-east"]).toBe(false); // eu-west-1 untouched
  });

  it("resurrects a tombstoned resource in place on re-observation", async () => {
    const m1 = await repo.bulkUpsert(scanA, [res({ externalId: "i-1" })]);
    const originalId = m1.get(
      resourceKey({ accountId, region: "us-west-2", service: "EC2", externalId: "i-1" }),
    );
    // tombstone it
    await repo.persistScan({
      accountId,
      scanId: scanB,
      resources: [],
      scannedScopes: [{ service: "EC2", region: "us-west-2" }],
    });
    // re-observe
    const m2 = await repo.bulkUpsert(scanA, [res({ externalId: "i-1" })]);
    const resurrectedId = m2.get(
      resourceKey({ accountId, region: "us-west-2", service: "EC2", externalId: "i-1" }),
    );
    expect(resurrectedId).toBe(originalId); // same uuid
    const rows = await db.execute(
      sql`select is_deleted from resources where external_id = 'i-1'`,
    );
    expect(rows.rows[0]!.is_deleted).toBe(false);
  });

  it("tombstones nothing when scannedScopes is empty (total failure guard)", async () => {
    await repo.bulkUpsert(scanA, [res({ externalId: "i-1" })]);
    const n = await repo.softDeleteAbsent(accountId, scanB, []);
    expect(n).toBe(0);
    const rows = await db.execute(
      sql`select is_deleted from resources where external_id = 'i-1'`,
    );
    expect(rows.rows[0]!.is_deleted).toBe(false);
  });
});
