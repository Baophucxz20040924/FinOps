import { desc, eq } from "drizzle-orm";
import type {
  ScanStats,
  ScanStatus,
  ServiceResult,
} from "@infra-explorer/domain";
import { scans as scansT, type ScanRow } from "../schema/scans";
import type { Database } from "../client";

/** Reads and writes scan rows through their lifecycle. */
export class ScansRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    accountId: string;
    regions: string[];
    triggeredBy: string;
  }): Promise<ScanRow> {
    const [row] = await this.db
      .insert(scansT)
      .values({
        accountId: input.accountId,
        regions: input.regions,
        triggeredBy: input.triggeredBy,
        status: "QUEUED",
      })
      .returning();
    return row!;
  }

  async getById(id: string): Promise<ScanRow | null> {
    const [row] = await this.db
      .select()
      .from(scansT)
      .where(eq(scansT.id, id))
      .limit(1);
    return row ?? null;
  }

  async listByAccount(accountId: string, limit = 20): Promise<ScanRow[]> {
    return this.db
      .select()
      .from(scansT)
      .where(eq(scansT.accountId, accountId))
      .orderBy(desc(scansT.createdAt))
      .limit(limit);
  }

  async markRunning(id: string): Promise<void> {
    await this.db
      .update(scansT)
      .set({ status: "RUNNING", startedAt: new Date() })
      .where(eq(scansT.id, id));
  }

  async finalize(
    id: string,
    input: {
      status: ScanStatus;
      serviceResults: ServiceResult[];
      stats: Partial<ScanStats>;
    },
  ): Promise<void> {
    await this.db
      .update(scansT)
      .set({
        status: input.status,
        serviceResults: input.serviceResults,
        stats: input.stats,
        finishedAt: new Date(),
      })
      .where(eq(scansT.id, id));
  }
}
