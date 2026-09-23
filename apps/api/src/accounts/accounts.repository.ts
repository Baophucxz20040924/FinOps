import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  accounts,
  type AccountRow,
  type Database,
  type NewAccountRow,
} from "@infra-explorer/db";
import type { AccountStatus } from "@infra-explorer/domain";
import { DATABASE } from "../db/db.module";

@Injectable()
export class AccountsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(row: NewAccountRow): Promise<AccountRow> {
    const [created] = await this.db.insert(accounts).values(row).returning();
    return created!;
  }

  async findAll(): Promise<AccountRow[]> {
    return this.db.select().from(accounts).orderBy(accounts.createdAt);
  }

  async findById(id: string): Promise<AccountRow | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByAwsAccountId(awsAccountId: string): Promise<AccountRow | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.awsAccountId, awsAccountId))
      .limit(1);
    return row ?? null;
  }

  async updateStatus(
    id: string,
    status: AccountStatus,
  ): Promise<AccountRow | null> {
    const [row] = await this.db
      .update(accounts)
      .set({ status, updatedAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(accounts)
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    return deleted.length > 0;
  }
}
