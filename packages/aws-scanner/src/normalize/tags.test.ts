import { describe, it, expect } from "vitest";
import {
  tagListToRecord,
  deriveName,
  deriveEnvironment,
} from "./tags";

describe("tagListToRecord", () => {
  it("converts a tag list to a record", () => {
    expect(
      tagListToRecord([
        { Key: "Name", Value: "api-prod" },
        { Key: "Environment", Value: "prod" },
      ]),
    ).toEqual({ Name: "api-prod", Environment: "prod" });
  });

  it("drops malformed entries and handles undefined", () => {
    expect(tagListToRecord(undefined)).toEqual({});
    expect(tagListToRecord([{ Key: "OnlyKey" }, { Value: "OnlyValue" }])).toEqual(
      {},
    );
  });
});

describe("deriveName", () => {
  it("prefers the Name tag", () => {
    expect(deriveName({ Name: "web-1" }, "i-123")).toBe("web-1");
  });
  it("falls back to the native id", () => {
    expect(deriveName({}, "i-123")).toBe("i-123");
  });
});

describe("deriveEnvironment", () => {
  it("reads common environment tag keys", () => {
    expect(deriveEnvironment({ Environment: "prod" })).toBe("prod");
    expect(deriveEnvironment({ stage: "staging" })).toBe("staging");
  });
  it("returns null when absent", () => {
    expect(deriveEnvironment({ Name: "x" })).toBeNull();
  });
});
