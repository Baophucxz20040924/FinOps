import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra-explorer/aws-scanner", () => ({
  verifyAccountAccess: vi.fn(),
}));

import { verifyAccountAccess } from "@infra-explorer/aws-scanner";
import { ConflictError, NotFoundError } from "@infra-explorer/shared";
import { AccountsService } from "./accounts.service";
import type { AccountsRepository } from "./accounts.repository";
import type { AppConfig } from "../config";
import type { AccountRow } from "@infra-explorer/db";
import type { CreateAccountBody } from "./accounts.schemas";

const verifyMock = vi.mocked(verifyAccountAccess);

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    awsAccountId: "123456789012",
    displayName: "Production",
    roleArn: "arn:aws:iam::123456789012:role/InfraExplorerReadOnly",
    externalId: "ie-abcdef0123456789",
    status: "PENDING_VERIFICATION",
    enabledRegions: ["us-west-2"],
    organizationId: null,
    createdAt: new Date("2026-09-23T00:00:00Z"),
    updatedAt: new Date("2026-09-23T00:00:00Z"),
    ...overrides,
  };
}

function makeRepo(): AccountsRepository {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findByAwsAccountId: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  } as unknown as AccountsRepository;
}

const config: AppConfig = {
  port: 4000,
  corsOrigins: [],
  awsRegion: "us-east-1",
  controlWorkerRoleArn: "arn:aws:iam::111111111111:role/InfraExplorerWorkerRole",
};

const body: CreateAccountBody = {
  displayName: "Production",
  awsAccountId: "123456789012",
  roleArn: "arn:aws:iam::123456789012:role/InfraExplorerReadOnly",
  enabledRegions: ["us-west-2"],
};

describe("AccountsService.register", () => {
  let repo: AccountsRepository;
  let service: AccountsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    service = new AccountsService(repo, config);
  });

  it("creates an account with a generated externalId and returns the worker ARN", async () => {
    vi.mocked(repo.findByAwsAccountId).mockResolvedValue(null);
    vi.mocked(repo.create).mockImplementation(async (row) =>
      makeRow({ externalId: row.externalId, status: "PENDING_VERIFICATION" }),
    );

    const result = await service.register(body);

    expect(result.externalId).toMatch(/^ie-[0-9a-f]{16}$/);
    expect(result.workerRoleArn).toBe(config.controlWorkerRoleArn);
    expect(result.account.status).toBe("PENDING_VERIFICATION");
    // the persisted externalId is the one returned to the caller
    expect(vi.mocked(repo.create).mock.calls[0]![0].externalId).toBe(
      result.externalId,
    );
  });

  it("rejects a duplicate AWS account id with a conflict", async () => {
    vi.mocked(repo.findByAwsAccountId).mockResolvedValue(makeRow());
    await expect(service.register(body)).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("AccountsService.verify", () => {
  let repo: AccountsRepository;
  let service: AccountsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    service = new AccountsService(repo, config);
  });

  it("marks the account ACTIVE when AssumeRole succeeds", async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeRow());
    verifyMock.mockResolvedValue({ ok: true, assumedAccountId: "123456789012" });

    const result = await service.verify(makeRow().id);

    expect(result.status).toBe("ACTIVE");
    expect(result.error).toBeUndefined();
    expect(repo.updateStatus).toHaveBeenCalledWith(makeRow().id, "ACTIVE");
  });

  it("marks the account INVALID and surfaces a safe error on failure", async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeRow());
    verifyMock.mockResolvedValue({
      ok: false,
      error: "Access denied assuming the role.",
    });

    const result = await service.verify(makeRow().id);

    expect(result.status).toBe("INVALID");
    expect(result.error).toMatch(/access denied/i);
    expect(repo.updateStatus).toHaveBeenCalledWith(makeRow().id, "INVALID");
  });

  it("throws NotFound when the account does not exist", async () => {
    vi.mocked(repo.findById).mockResolvedValue(null);
    await expect(service.verify("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
