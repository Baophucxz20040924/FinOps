import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { ScansController } from "./scans.controller";
import { ScansService } from "./scans.service";

@Module({
  imports: [AccountsModule],
  controllers: [ScansController],
  providers: [ScansService],
})
export class ScansModule {}
