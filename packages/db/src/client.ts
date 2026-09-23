import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export interface CreateDbOptions {
  connectionString?: string;
  pool?: PoolConfig;
}

/**
 * Creates a Drizzle client backed by a pg Pool. Callers own the returned pool
 * and should close it on shutdown via `closeDb`.
 */
export function createDb(opts: CreateDbOptions = {}): {
  db: Database;
  pool: Pool;
} {
  const connectionString =
    opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a database client");
  }
  const pool = new Pool({ connectionString, ...opts.pool });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function closeDb(pool: Pool): Promise<void> {
  await pool.end();
}
