import type { Database } from "../client";

/** A transaction handle as produced by `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either the base db or a transaction, so repo methods can run inside a txn. */
export type Executor = Database | Tx;

/**
 * Delimiter for composite Map keys. A NUL char cannot appear in AWS resource
 * ids, uuids, region codes, or service names, so keys built by joining those
 * components on it can never collide across a component boundary. Built via
 * String.fromCharCode so no raw control byte lands in source.
 */
export const KEY_DELIMITER = String.fromCharCode(0);

/** Joins natural-key components into a collision-free composite Map key. */
export function joinKey(...parts: string[]): string {
  return parts.join(KEY_DELIMITER);
}

/** Splits items into fixed-size chunks (used to stay under Postgres param caps). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
