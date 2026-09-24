import { eq } from "drizzle-orm";
import {
  accounts as accountsT,
  okScopesFromServiceResults,
  ResourcesRepository,
  ScansRepository,
  type Database,
} from "@infra-explorer/db";
import { createRelationshipEngine } from "@infra-explorer/relationship-engine";
import {
  ApiCallRecorder,
  createAssumedCredentials,
  defaultScanners,
  type RawDiscoveryResult,
  type ResourceScanner,
  type ScanContext,
  type ScanTarget,
} from "@infra-explorer/aws-scanner";
import {
  GLOBAL_REGION,
  type NormalizedResource,
  type ScanStatus,
  type ServiceResult,
} from "@infra-explorer/domain";
import type { Logger } from "@infra-explorer/shared";

export interface OrchestratorDeps {
  db: Database;
  logger: Logger;
  /** Injectable for tests; defaults to the real scanner registry. */
  scanners?: ResourceScanner[];
  /** Region for the STS AssumeRole client. */
  awsRegion?: string;
}

/** Builds a per-(service,region) result from a scanner's discovery output. */
function toServiceResult(
  service: string,
  region: string,
  result: RawDiscoveryResult,
): ServiceResult {
  const throttled = result.errors.some((e) => e.throttled);
  // Any error ⇒ the scope was NOT fully enumerated, so it must not be treated
  // as OK (that would let scope-gated soft-delete tombstone rows we didn't
  // authoritatively re-list). Resources found are still upserted.
  const status =
    result.errors.length > 0 ? (throttled ? "THROTTLED" : "FAILED") : "OK";
  return {
    service,
    region,
    status,
    resourceCount: result.resources.length,
    error: result.errors[0]?.message,
  };
}

function rollupStatus(results: ServiceResult[]): ScanStatus {
  if (results.length === 0) return "SUCCESS";
  const okCount = results.filter((r) => r.status === "OK").length;
  if (okCount === results.length) return "SUCCESS";
  if (okCount === 0) return "FAILED";
  return "PARTIAL_SUCCESS";
}

/**
 * Runs the full scan pipeline for one scan: assume the account's read-only role,
 * run each scanner (global once, regional per region) with per-scope partial
 * failure isolation, persist resources with scope-gated soft-delete, build the
 * relationship graph, and finalize the scan's status + stats.
 */
export class ScanOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(scanId: string): Promise<void> {
    const { db, logger } = this.deps;
    const scansRepo = new ScansRepository(db);
    const resourcesRepo = new ResourcesRepository(db);
    const engine = createRelationshipEngine({ db, logger });

    const scan = await scansRepo.getById(scanId);
    if (!scan) throw new Error(`Scan ${scanId} not found`);

    const [account] = await db
      .select()
      .from(accountsT)
      .where(eq(accountsT.id, scan.accountId))
      .limit(1);
    if (!account) throw new Error(`Account ${scan.accountId} not found`);

    await scansRepo.markRunning(scanId);
    const startedAt = Date.now();
    const recorder = new ApiCallRecorder();

    const target: ScanTarget = {
      accountId: account.id,
      awsAccountId: account.awsAccountId,
      credentials: createAssumedCredentials({
        roleArn: account.roleArn,
        externalId: account.externalId,
        region: this.deps.awsRegion ?? "us-east-1",
        sessionName: "infra-explorer-scan",
      }),
    };

    const scanners = this.deps.scanners ?? defaultScanners();
    const regional = scanners.filter((s) => s.scope === "REGIONAL");
    const global = scanners.filter((s) => s.scope === "GLOBAL");

    const allResources: NormalizedResource[] = [];
    const serviceResults: ServiceResult[] = [];

    // Global scanners run exactly once (region = "global"), not per region.
    for (const scanner of global) {
      const result = await this.runScanner(scanner, target, GLOBAL_REGION, recorder);
      allResources.push(...result.resources);
      serviceResults.push(
        toServiceResult(scanner.service, GLOBAL_REGION, result),
      );
    }

    // Regional scanners run once per region.
    for (const region of scan.regions) {
      for (const scanner of regional) {
        const result = await this.runScanner(scanner, target, region, recorder);
        allResources.push(...result.resources);
        serviceResults.push(toServiceResult(scanner.service, region, result));
      }
    }

    // Persist: upsert everything, soft-delete only within OK scopes.
    const okScopes = okScopesFromServiceResults(
      serviceResults.map((r) => ({
        service: r.service,
        region: r.region,
        status: r.status,
      })),
    );
    await resourcesRepo.persistScan({
      accountId: account.id,
      scanId,
      resources: allResources,
      scannedScopes: okScopes,
    });

    // Build the relationship graph over the account's full live set.
    const build = await engine.build(scanId);

    const status = rollupStatus(serviceResults);
    await scansRepo.finalize(scanId, {
      status,
      serviceResults,
      stats: {
        resourcesDiscovered: allResources.length,
        findingsGenerated: 0,
        apiCallsMade: recorder.totalCalls,
        apiThrottles: recorder.totalThrottles,
        durationMs: Date.now() - startedAt,
      },
    });

    logger.info(
      {
        scanId,
        status,
        resources: allResources.length,
        edges: build.edgesUpserted,
        apiCalls: recorder.totalCalls,
      },
      "Scan complete",
    );
  }

  /** Runs one scanner, isolating a thrown error into a scope-level failure. */
  private async runScanner(
    scanner: ResourceScanner,
    target: ScanTarget,
    region: string,
    recorder: ApiCallRecorder,
  ): Promise<RawDiscoveryResult> {
    const ctx: ScanContext = {
      target,
      region,
      logger: this.deps.logger.child({ service: scanner.service, region }),
      recorder,
    };
    try {
      return await scanner.scan(ctx);
    } catch (err) {
      this.deps.logger.warn(
        { err, service: scanner.service, region },
        "Scanner threw — recording scope failure",
      );
      return {
        resources: [],
        errors: [
          {
            service: scanner.service,
            region,
            message: err instanceof Error ? err.message : "Scanner crashed",
            throttled: false,
          },
        ],
      };
    }
  }
}
