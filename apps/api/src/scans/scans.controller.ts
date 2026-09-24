import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import type { Scan } from "@infra-explorer/domain";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ScansService } from "./scans.service";
import { createScanSchema, type CreateScanBody } from "./scans.schemas";

@Controller("scans")
export class ScansController {
  constructor(private readonly service: ScansService) {}

  @Post()
  @HttpCode(202)
  trigger(
    @Body(new ZodValidationPipe(createScanSchema)) body: CreateScanBody,
  ): Promise<{ scanId: string; status: string }> {
    return this.service.trigger(body, "api");
  }

  @Get()
  list(@Query("accountId") accountId?: string): Promise<Scan[]> {
    if (!accountId) throw new BadRequestException("accountId is required");
    return this.service.listByAccount(accountId);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<Scan> {
    return this.service.get(id);
  }
}
