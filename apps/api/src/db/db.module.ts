import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createDb, closeDb, type Database } from "@infra-explorer/db";

export const DATABASE = Symbol("DATABASE");
const DB_CONNECTION = Symbol("DB_CONNECTION");

/** { db, pool } — pool type derived without a direct dependency on `pg`. */
type DbConnection = ReturnType<typeof createDb>;

/**
 * Provides a single shared Drizzle client (backed by a pg Pool) to the whole
 * app and closes the pool on shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: (): DbConnection => createDb(),
    },
    {
      provide: DATABASE,
      useFactory: (conn: DbConnection): Database => conn.db,
      inject: [DB_CONNECTION],
    },
  ],
  exports: [DATABASE],
})
export class DbModule implements OnModuleDestroy {
  constructor(
    @Inject(DB_CONNECTION) private readonly connection: DbConnection,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await closeDb(this.connection.pool);
  }
}
