import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConflictError, NotFoundError } from "@infra-explorer/shared";
import { verifyAccountAccess } from "@infra-explorer/aws-scanner";
import type {
  Account,
  AccountVerificationResult,
} from "@infra-explorer/domain";
import { APP_CONFIG, type AppConfig } from "../config";
import { AccountsRepository } from "./accounts.repository";
import { toAccount } from "./accounts.mapper";
import type { CreateAccountBody } from "./accounts.schemas";

/** Generates a per-account ExternalId (confused-deputy mitigation). */
function generateExternalId(): string {
  return `ie-${randomBytes(8).toString("hex")}`;
}

export interface RegisterAccountResult {
  account: Account;
  /** Surfaced so the operator can add it to the target role's trust policy. */
  externalId: string;
  /** Principal the target role must trust; empty if not configured. */
  workerRoleArn: string;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly repo: AccountsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(body: CreateAccountBody): Promise<RegisterAccountResult> {
    const existing = await this.repo.findByAwsAccountId(body.awsAccountId);
    if (existing) {
      throw new ConflictError(
        `AWS account ${body.awsAccountId} is already registered`,
      );
    }

    const externalId = generateExternalId();
    const row = await this.repo.create({
      awsAccountId: body.awsAccountId,
      displayName: body.displayName,
      roleArn: body.roleArn,
      externalId,
      enabledRegions: body.enabledRegions,
      status: "PENDING_VERIFICATION",
    });

    return {
      account: toAccount(row),
      externalId,
      workerRoleArn: this.config.controlWorkerRoleArn,
    };
  }

  async list(): Promise<Account[]> {
    const rows = await this.repo.findAll();
    return rows.map(toAccount);
  }

  async get(id: string): Promise<Account> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError(`Account ${id} not found`);
    return toAccount(row);
  }

  /**
   * Attempts a single AssumeRole against the account and records the outcome as
   * ACTIVE or INVALID. The client-safe error (if any) is returned but not
   * persisted beyond the status.
   */
  async verify(id: string): Promise<AccountVerificationResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError(`Account ${id} not found`);

    const result = await verifyAccountAccess({
      roleArn: row.roleArn,
      externalId: row.externalId,
      region: this.config.awsRegion,
      sessionName: "infra-explorer-verify",
    });

    const status = result.ok ? "ACTIVE" : "INVALID";
    await this.repo.updateStatus(id, status);

    return {
      accountId: id,
      status,
      error: result.ok ? undefined : result.error,
    };
  }

  async remove(id: string): Promise<void> {
    const removed = await this.repo.delete(id);
    if (!removed) throw new NotFoundError(`Account ${id} not found`);
  }
}
