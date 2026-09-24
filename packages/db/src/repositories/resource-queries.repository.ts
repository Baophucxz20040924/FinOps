import { and, asc, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { ResourceFilter } from "@infra-explorer/domain";
import { resources as resourcesT } from "../schema/resources";
import { relationships as relationshipsT } from "../schema/relationships";
import type { Database } from "../client";
import type { ResourceRow } from "../schema/resources";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Read-side queries for resources, relationships, the graph, and overview. */
export class ResourceQueriesRepository {
  constructor(private readonly db: Database) {}

  /** Builds the WHERE conditions shared by list + count, excluding soft-deleted. */
  private conditions(filter: ResourceFilter) {
    const conds = [eq(resourcesT.isDeleted, false)];
    if (filter.accountId) conds.push(eq(resourcesT.accountId, filter.accountId));
    if (filter.service) conds.push(eq(resourcesT.service, filter.service));
    if (filter.region) conds.push(eq(resourcesT.region, filter.region));
    if (filter.type) conds.push(eq(resourcesT.type, filter.type));
    if (filter.state) conds.push(eq(resourcesT.state, filter.state));
    if (filter.environment)
      conds.push(eq(resourcesT.environment, filter.environment));
    if (filter.search)
      conds.push(ilike(resourcesT.name, `%${filter.search}%`));
    return conds;
  }

  /** Paginated, filtered resource list (newest first). */
  async list(
    filter: ResourceFilter,
  ): Promise<{ items: ResourceRow[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const conds = this.conditions(filter);

    const [items, totalRow] = await Promise.all([
      this.db
        .select()
        .from(resourcesT)
        .where(and(...conds))
        .orderBy(desc(resourcesT.lastSeenAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ n: count() })
        .from(resourcesT)
        .where(and(...conds)),
    ]);

    return { items, total: totalRow[0]?.n ?? 0, page, pageSize };
  }

  async getById(id: string): Promise<ResourceRow | null> {
    const [row] = await this.db
      .select()
      .from(resourcesT)
      .where(eq(resourcesT.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Outgoing + incoming relationships for a resource, with the neighbor row. */
  async relationshipsFor(id: string): Promise<{
    outgoing: Array<{ type: string; confidence: string; target: ResourceRow }>;
    incoming: Array<{ type: string; confidence: string; source: ResourceRow }>;
  }> {
    const outgoing = await this.db
      .select({
        type: relationshipsT.type,
        confidence: relationshipsT.confidence,
        target: resourcesT,
      })
      .from(relationshipsT)
      .innerJoin(resourcesT, eq(relationshipsT.targetResourceId, resourcesT.id))
      .where(eq(relationshipsT.sourceResourceId, id));

    const incoming = await this.db
      .select({
        type: relationshipsT.type,
        confidence: relationshipsT.confidence,
        source: resourcesT,
      })
      .from(relationshipsT)
      .innerJoin(resourcesT, eq(relationshipsT.sourceResourceId, resourcesT.id))
      .where(eq(relationshipsT.targetResourceId, id));

    return { outgoing, incoming };
  }

  /** Resource counts grouped by service for an account (optionally a region). */
  async countsByService(
    accountId: string,
    region?: string,
  ): Promise<Array<{ service: string; count: number }>> {
    const conds = [
      eq(resourcesT.accountId, accountId),
      eq(resourcesT.isDeleted, false),
    ];
    if (region) conds.push(eq(resourcesT.region, region));
    const rows = await this.db
      .select({ service: resourcesT.service, n: count() })
      .from(resourcesT)
      .where(and(...conds))
      .groupBy(resourcesT.service)
      .orderBy(asc(resourcesT.service));
    return rows.map((r) => ({ service: r.service, count: r.n }));
  }

  /**
   * Graph query: nodes for an account (optionally filtered), plus the edges
   * among those nodes. Returns { overLimit: true } instead of truncating when
   * the node count exceeds `cap`, so the UI can prompt for narrower filters.
   */
  async graph(
    filter: { accountId: string; region?: string; service?: string; environment?: string },
    cap = 500,
  ): Promise<
    | { overLimit: true; nodeCount: number; cap: number }
    | {
        overLimit: false;
        nodes: ResourceRow[];
        edges: Array<{ source: string; target: string; type: string; confidence: string }>;
      }
  > {
    const conds = [
      eq(resourcesT.accountId, filter.accountId),
      eq(resourcesT.isDeleted, false),
    ];
    if (filter.region) conds.push(eq(resourcesT.region, filter.region));
    if (filter.service) conds.push(eq(resourcesT.service, filter.service));
    if (filter.environment)
      conds.push(eq(resourcesT.environment, filter.environment));

    const countRows = await this.db
      .select({ n: count() })
      .from(resourcesT)
      .where(and(...conds));
    const nodeCount = countRows[0]?.n ?? 0;

    if (nodeCount > cap) {
      return { overLimit: true, nodeCount, cap };
    }

    const nodes = await this.db
      .select()
      .from(resourcesT)
      .where(and(...conds));

    if (nodes.length === 0) {
      return { overLimit: false, nodes, edges: [] };
    }

    const nodeIds = nodes.map((n) => n.id);
    const edges = await this.db
      .select({
        source: relationshipsT.sourceResourceId,
        target: relationshipsT.targetResourceId,
        type: relationshipsT.type,
        confidence: relationshipsT.confidence,
      })
      .from(relationshipsT)
      .where(
        and(
          inArray(relationshipsT.sourceResourceId, nodeIds),
          inArray(relationshipsT.targetResourceId, nodeIds),
        ),
      );

    return { overLimit: false, nodes, edges };
  }

  /** Ids of resources that have at least one open finding (for badges). */
  async resourceIdsWithFindings(nodeIds: string[]): Promise<Set<string>> {
    if (nodeIds.length === 0) return new Set();
    // Findings table may not exist yet in all environments; guard defensively.
    try {
      const rows = await this.db.execute(
        sql`select distinct resource_id from findings where status = 'OPEN' and resource_id in (${sql.join(
          nodeIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
      return new Set(rows.rows.map((r) => String(r.resource_id)));
    } catch {
      return new Set();
    }
  }
}
