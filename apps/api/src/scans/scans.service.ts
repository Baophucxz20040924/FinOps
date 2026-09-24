import { Inject, Injectable } from "@nestjs/common";
import PgBoss from "pg-boss";
import { ScansRepository, type Database } from "@infra-explorer/db";
import {
  NotFoundError,
  ValidationError,
  SCAN_QUEUE,
  type ScanJob,
} from "@infra-explorer/shared";
import type { Scan } from "@infra-explorer/domain";
import { DATABASE } from "../db/db.module";
import { BOSS } from "../queue/queue.module";
import { AccountsRepository } from "../accounts/accounts.repository";
import { toScan } from "./scans.mapper";
import type { CreateScanBody } from "./scans.schemas";

@Injectable()
export class ScansService {
  private readonly repo: ScansRepository;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    private readonly accountsRepo: AccountsRepository,
  ) {
    this.repo = new ScansRepository(db);
  }

  /** Creates a QUEUED scan row and enqueues the job; returns immediately. */
  async trigger(
    body: CreateScanBody,
    triggeredBy: string,
  ): Promise<{ scanId: string; status: string }> {
    const account = await this.accountsRepo.findById(body.accountId);
    if (!account) throw new NotFoundError(`Account ${body.accountId} not found`);
    if (account.status !== "ACTIVE") {
      throw new ValidationError(
        `Account is ${account.status}; verify it before scanning`,
      );
    }

    const regions =
      body.regions && body.regions.length > 0
        ? body.regions
        : account.enabledRegions;
    if (regions.length === 0) {
      throw new ValidationError("No regions to scan for this account");
    }
    // Guard against scanning a region the account hasn't enabled.
    const invalid = regions.filter((r) => !account.enabledRegions.includes(r));
    if (invalid.length > 0) {
      throw new ValidationError(
        `Regions not enabled for this account: ${invalid.join(", ")}`,
      );
    }

    const scan = await this.repo.create({
      accountId: account.id,
      regions,
      triggeredBy,
    });

    await this.boss.send(SCAN_QUEUE, { scanId: scan.id } satisfies ScanJob);

    return { scanId: scan.id, status: scan.status };
  }

  async get(id: string): Promise<Scan> {
    const row = await this.repo.getById(id);
    if (!row) throw new NotFoundError(`Scan ${id} not found`);
    return toScan(row);
  }

  async listByAccount(accountId: string): Promise<Scan[]> {
    const rows = await this.repo.listByAccount(accountId);
    return rows.map(toScan);
  }
}
