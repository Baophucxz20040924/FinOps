import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module";
import { DbModule } from "./db/db.module";
import { QueueModule } from "./queue/queue.module";
import { HealthController } from "./health/health.controller";
import { AccountsModule } from "./accounts/accounts.module";
import { ResourcesModule } from "./resources/resources.module";
import { ScansModule } from "./scans/scans.module";

@Module({
  imports: [
    ConfigModule,
    DbModule,
    QueueModule,
    AccountsModule,
    ResourcesModule,
    ScansModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
