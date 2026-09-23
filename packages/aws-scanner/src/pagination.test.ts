import { describe, it, expect, vi } from "vitest";
import { paginate } from "./pagination";

interface Page {
  values: number[];
  token?: string;
}

describe("paginate", () => {
  it("collects items across multiple pages", async () => {
    const pages: Record<string, Page> = {
      START: { values: [1, 2], token: "p2" },
      p2: { values: [3, 4], token: "p3" },
      p3: { values: [5] },
    };
    const fetchPage = vi.fn(async (token: string | undefined) => {
      const page = pages[token ?? "START"]!;
      return { page, nextToken: page.token };
    });

    const items = await paginate(
      fetchPage,
      (p) => p.values,
      { retry: { sleep: () => Promise.resolve() } },
    );

    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("handles a single empty page", async () => {
    const fetchPage = vi.fn(async () => ({
      page: { values: [] as number[] },
      nextToken: undefined,
    }));
    const items = await paginate(fetchPage, (p) => p.values);
    expect(items).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("respects the maxPages safety cap", async () => {
    // Always returns a next token — would loop forever without the cap.
    const fetchPage = vi.fn(async () => ({
      page: { values: [1] },
      nextToken: "always",
    }));
    const items = await paginate(fetchPage, (p) => p.values, { maxPages: 4 });
    expect(items).toHaveLength(4);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });
});
