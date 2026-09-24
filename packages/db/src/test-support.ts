/**
 * Resolves the connection string DB-gated tests should use.
 *
 * DB integration tests TRUNCATE tables, so they must NEVER run against the app
 * database. This returns an explicit TEST_DATABASE_URL if set, otherwise it
 * derives a sibling `<name>_test` database from DATABASE_URL (e.g.
 * infra_explorer → infra_explorer_test). Returns undefined when no DATABASE_URL
 * is set, so the tests skip. The `<name>_test` database must exist and be
 * migrated (see the README testing section).
 */
export function resolveTestDatabaseUrl(): string | undefined {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) return undefined;

  // Swap the final path segment (db name) for `<name>_test`, keeping any query.
  return base.replace(
    /\/([^/?]+)(\?.*)?$/,
    (_m, name: string, query: string | undefined) =>
      `/${name}_test${query ?? ""}`,
  );
}
