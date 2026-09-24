import { Inject, Injectable } from "@nestjs/common";
import { ResourceQueriesRepository, type Database } from "@infra-explorer/db";
import { NotFoundError } from "@infra-explorer/shared";
import type {
  Graph,
  Paginated,
  Resource,
  ResourceFilter,
  ResourceRelationships,
  ResourceSummary,
} from "@infra-explorer/domain";
import { DATABASE } from "../db/db.module";
import {
  toGraphNode,
  toResource,
  toResourceSummary,
} from "./resources.mapper";

export type GraphResult =
  | { overLimit: true; nodeCount: number; cap: number }
  | Graph;

@Injectable()
export class ResourcesService {
  private readonly repo: ResourceQueriesRepository;

  constructor(@Inject(DATABASE) db: Database) {
    this.repo = new ResourceQueriesRepository(db);
  }

  async list(filter: ResourceFilter): Promise<Paginated<ResourceSummary>> {
    const { items, total, page, pageSize } = await this.repo.list(filter);
    const withFindings = await this.repo.resourceIdsWithFindings(
      items.map((r) => r.id),
    );
    return {
      items: items.map((r) =>
        toResourceSummary(r, {
          estimatedMonthlyCost: null, // cost engine not built yet
          findingsCount: withFindings.has(r.id) ? 1 : 0,
        }),
      ),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<Resource> {
    const row = await this.repo.getById(id);
    if (!row) throw new NotFoundError(`Resource ${id} not found`);
    return toResource(row);
  }

  async relationships(id: string): Promise<ResourceRelationships> {
    const row = await this.repo.getById(id);
    if (!row) throw new NotFoundError(`Resource ${id} not found`);
    const { outgoing, incoming } = await this.repo.relationshipsFor(id);
    return {
      outgoing: outgoing.map((o) => ({
        type: o.type as ResourceRelationships["outgoing"][number]["type"],
        target: toResourceSummary(o.target, {
          estimatedMonthlyCost: null,
          findingsCount: 0,
        }),
      })),
      incoming: incoming.map((i) => ({
        type: i.type as ResourceRelationships["incoming"][number]["type"],
        source: toResourceSummary(i.source, {
          estimatedMonthlyCost: null,
          findingsCount: 0,
        }),
      })),
    };
  }

  async graph(filter: {
    accountId: string;
    region?: string;
    service?: string;
    environment?: string;
  }): Promise<GraphResult> {
    const result = await this.repo.graph(filter);
    if (result.overLimit) return result;
    const withFindings = await this.repo.resourceIdsWithFindings(
      result.nodes.map((n) => n.id),
    );
    return {
      nodes: result.nodes.map((n) => toGraphNode(n, withFindings.has(n.id))),
      edges: result.edges.map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type as Graph["edges"][number]["type"],
        confidence: e.confidence as Graph["edges"][number]["confidence"],
      })),
    };
  }

  async overview(
    accountId: string,
    region?: string,
  ): Promise<{
    countsByService: Array<{ service: string; count: number }>;
    totalResources: number;
  }> {
    const countsByService = await this.repo.countsByService(accountId, region);
    const totalResources = countsByService.reduce((s, c) => s + c.count, 0);
    return { countsByService, totalResources };
  }
}
