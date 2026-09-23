import { describe, it, expect, vi } from "vitest";
import { withRetry, isThrottlingError, isRetryableError } from "./retry";

const throttle = (): Error => Object.assign(new Error("rate exceeded"), {
  name: "ThrottlingException",
});
const fatal = (): Error => Object.assign(new Error("bad input"), {
  name: "ValidationException",
});

const noSleep = (): Promise<void> => Promise.resolve();
const fixedRandom = (): number => 0.5;

describe("isThrottlingError", () => {
  it("detects throttle error names", () => {
    expect(isThrottlingError(throttle())).toBe(true);
  });
  it("detects http 429", () => {
    expect(
      isThrottlingError({ $metadata: { httpStatusCode: 429 } }),
    ).toBe(true);
  });
  it("rejects unrelated errors", () => {
    expect(isThrottlingError(fatal())).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("treats 5xx as retryable", () => {
    expect(isRetryableError({ $metadata: { httpStatusCode: 503 } })).toBe(true);
  });
  it("does not retry validation errors", () => {
    expect(isRetryableError(fatal())).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries throttling errors then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(throttle())
      .mockRejectedValueOnce(throttle())
      .mockResolvedValue("ok");
    const onRetry = vi.fn();
    const result = await withRetry(fn, {
      sleep: noSleep,
      random: fixedRandom,
      onRetry,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("throws non-retryable errors immediately", async () => {
    const fn = vi.fn().mockRejectedValue(fatal());
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow("bad input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(throttle());
    await expect(
      withRetry(fn, { sleep: noSleep, maxAttempts: 3 }),
    ).rejects.toMatchObject({ name: "ThrottlingException" });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
