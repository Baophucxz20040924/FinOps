import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { AccountsModule } from "./accounts/accounts.module";
import { ResourcesModule } from "./resources/resources.module";

@Module({
  imports: [ConfigModule, DbModule, AccountsModule, ResourcesModule],
  controllers: [HealthController],
})
export class AppModule {}
