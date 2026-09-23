import { withRetry, type RetryOptions } from "./retry";

export interface FetchPageResult<TPage> {
  page: TPage;
  nextToken: string | undefined;
}

export type PageFetcher<TPage> = (
  token: string | undefined,
) => Promise<FetchPageResult<TPage>>;

export interface PaginateOptions {
  retry?: RetryOptions;
  /** Safety cap on pages to avoid pathological loops. */
  maxPages?: number;
}

/**
 * Drives a token-based AWS paginated API to completion, retrying each page with
 * backoff. Keeping pagination explicit (rather than relying on SDK paginator
 * internals) lets us wrap every call in the same retry + recording path.
 */
export async function paginate<TPage, TItem>(
  fetchPage: PageFetcher<TPage>,
  extractItems: (page: TPage) => TItem[] | undefined,
  opts: PaginateOptions = {},
): Promise<TItem[]> {
  const items: TItem[] = [];
  const maxPages = opts.maxPages ?? 10_000;
  let token: string | undefined;
  let pages = 0;

  do {
    const { page, nextToken } = await withRetry(
      () => fetchPage(token),
      opts.retry,
    );
    const pageItems = extractItems(page);
    if (pageItems && pageItems.length > 0) {
      items.push(...pageItems);
    }
    token = nextToken;
    pages += 1;
  } while (token && pages < maxPages);

  return items;
}
