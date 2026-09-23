import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";
import {
  isValidRoleArn,
  accountIdFromRoleArn,
  mapStsError,
  verifyAccountAccess,
} from "./credentials";

const stsMock = mockClient(STSClient);

const VALID_ARN = "arn:aws:iam::123456789012:role/InfraExplorerReadOnly";

beforeEach(() => {
  stsMock.reset();
});

describe("isValidRoleArn", () => {
  it("accepts a well-formed role ARN", () => {
    expect(isValidRoleArn(VALID_ARN)).toBe(true);
    expect(isValidRoleArn("arn:aws:iam::123456789012:role/path/to/Role")).toBe(
      true,
    );
  });
  it("rejects malformed ARNs", () => {
    expect(isValidRoleArn("not-an-arn")).toBe(false);
    expect(isValidRoleArn("arn:aws:iam::123:role/Short")).toBe(false);
    expect(
      isValidRoleArn("arn:aws:s3:::bucket/object"),
    ).toBe(false);
  });
});

describe("accountIdFromRoleArn", () => {
  it("extracts the account id", () => {
    expect(accountIdFromRoleArn(VALID_ARN)).toBe("123456789012");
  });
  it("returns null for malformed input", () => {
    expect(accountIdFromRoleArn("nope")).toBeNull();
  });
});

describe("mapStsError", () => {
  it("maps AccessDenied to a trust-policy hint", () => {
    expect(mapStsError({ name: "AccessDenied" })).toMatch(/trust policy/i);
  });
  it("has a safe default", () => {
    expect(mapStsError({ name: "Weird" })).toMatch(/could not assume the role/i);
  });
});

describe("verifyAccountAccess", () => {
  it("rejects an invalid ARN without calling STS", async () => {
    const result = await verifyAccountAccess({
      roleArn: "bad",
      externalId: "ie-abc12345",
    });
    expect(result).toEqual({ ok: false, error: "Invalid role ARN format." });
    expect(stsMock.calls()).toHaveLength(0);
  });

  it("returns ok with the assumed account id on success", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "AKIA_TEST",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: new Date(Date.now() + 3_600_000),
      },
    });
    stsMock
      .on(GetCallerIdentityCommand)
      .resolves({ Account: "123456789012" });

    const result = await verifyAccountAccess({
      roleArn: VALID_ARN,
      externalId: "ie-abc12345",
    });
    expect(result).toEqual({ ok: true, assumedAccountId: "123456789012" });
  });

  it("maps an AccessDenied failure to a client-safe message", async () => {
    stsMock
      .on(AssumeRoleCommand)
      .rejects(Object.assign(new Error("denied"), { name: "AccessDenied" }));

    const result = await verifyAccountAccess({
      roleArn: VALID_ARN,
      externalId: "ie-wrong",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/trust policy|ExternalId/i);
    }
  });
});
