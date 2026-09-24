import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { config as dotenvConfig } from "dotenv";

let loadedPath: string | null | undefined;

/**
 * Loads the nearest `.env` file, searching upward from the current working
 * directory (so a single repo-root `.env` is found no matter which package dir a
 * service is started from). Idempotent, and does NOT override variables already
 * present in the environment — an explicitly exported var always wins over `.env`.
 *
 * Call this once, first thing at process startup, before any config or AWS
 * credential resolution (e.g. AWS_PROFILE / AWS_REGION / DATABASE_URL).
 * Returns the path loaded, or null if no `.env` was found.
 */
export function loadDotenv(startDir: string = process.cwd()): string | null {
  if (loadedPath !== undefined) return loadedPath;

  let dir = startDir;
  const { root } = parse(dir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      loadedPath = candidate;
      return loadedPath;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  loadedPath = null;
  return null;
}
