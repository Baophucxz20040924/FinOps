import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import type {
  Graph,
  Paginated,
  Resource,
  ResourceRelationships,
  ResourceSummary,
} from "@infra-explorer/domain";
import { ResourcesService, type GraphResult } from "./resources.service";

@Controller()
export class ResourcesController {
  constructor(private readonly service: ResourcesService) {}

  @Get("resources")
  list(
    @Query("accountId") accountId?: string,
    @Query("service") service?: string,
    @Query("region") region?: string,
    @Query("type") type?: string,
    @Query("state") state?: string,
    @Query("environment") environment?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ): Promise<Paginated<ResourceSummary>> {
    return this.service.list({
      accountId,
      service,
      region,
      type,
      state,
      environment,
      search,
      page: page ? Number.parseInt(page, 10) : undefined,
      pageSize: pageSize ? Number.parseInt(pageSize, 10) : undefined,
    });
  }

  @Get("resources/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<Resource> {
    return this.service.get(id);
  }

  @Get("resources/:id/relationships")
  relationships(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ResourceRelationships> {
    return this.service.relationships(id);
  }

  @Get("graph")
  graph(
    @Query("accountId") accountId?: string,
    @Query("region") region?: string,
    @Query("service") service?: string,
    @Query("environment") environment?: string,
  ): Promise<GraphResult> {
    if (!accountId) {
      throw new BadRequestException("accountId is required for the graph");
    }
    return this.service.graph({ accountId, region, service, environment });
  }

  @Get("overview")
  overview(
    @Query("accountId") accountId?: string,
    @Query("region") region?: string,
  ): Promise<{
    countsByService: Array<{ service: string; count: number }>;
    totalResources: number;
  }> {
    if (!accountId) {
      throw new BadRequestException("accountId is required for overview");
    }
    return this.service.overview(accountId, region);
  }
}
