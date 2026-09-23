import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import type {
  Account,
  AccountVerificationResult,
} from "@infra-explorer/domain";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AccountsService, type RegisterAccountResult } from "./accounts.service";
import { createAccountSchema, type CreateAccountBody } from "./accounts.schemas";

@Controller("accounts")
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  @HttpCode(201)
  register(
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountBody,
  ): Promise<RegisterAccountResult> {
    return this.service.register(body);
  }

  @Get()
  list(): Promise<Account[]> {
    return this.service.list();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<Account> {
    return this.service.get(id);
  }

  @Post(":id/verify")
  @HttpCode(200)
  verify(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AccountVerificationResult> {
    return this.service.verify(id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
