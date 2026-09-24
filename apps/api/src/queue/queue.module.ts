import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import PgBoss from "pg-boss";
import { requireEnv, SCAN_QUEUE } from "@infra-explorer/shared";

export const BOSS = Symbol("BOSS");

/**
 * Provides a started pg-boss instance (Postgres-native job queue) used to
 * enqueue scan jobs. The worker process consumes them.
 */
@Global()
@Module({
  providers: [
    {
      provide: BOSS,
      useFactory: (): PgBoss => new PgBoss(requireEnv("DATABASE_URL")),
    },
  ],
  exports: [BOSS],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(SCAN_QUEUE);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop();
  }
}
