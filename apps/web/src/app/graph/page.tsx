"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useAccount } from "../../lib/account-context";
import { api } from "../../lib/api";
import { Empty } from "../../components/ui";
import { InfraGraph } from "../../components/graph/InfraGraph";
import { ResourceDetailDrawer } from "../../components/ResourceDetailDrawer";

export default function GraphPage(): ReactNode {
  const { selectedAccountId, region } = useAccount();
  const [service, setService] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["graph", selectedAccountId, region, service],
    queryFn: () =>
      api.graph({
        accountId: selectedAccountId!,
        region: region ?? undefined,
        service: service || undefined,
      }),
    enabled: Boolean(selectedAccountId),
  });

  if (!selectedAccountId)
    return <Empty>Register and select an AWS account to begin.</Empty>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <input
          className="w-64 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="Highlight by name / service…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">All services</option>
          {["EC2", "EBS", "VPC", "RDS", "ECS", "ALB", "S3", "Lambda", "SQS", "CloudFront"].map(
            (s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ),
          )}
        </select>
        {data && !("overLimit" in data) && (
          <span className="ml-auto text-sm text-neutral-500">
            {data.nodes.length} nodes · {data.edges.length} edges
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <Empty>Loading graph…</Empty>
        ) : error ? (
          <Empty>Failed: {(error as Error).message}</Empty>
        ) : data && "overLimit" in data ? (
          <Empty>
            {data.nodeCount} resources exceed the {data.cap}-node cap — narrow
            your filters (service / region).
          </Empty>
        ) : !data || data.nodes.length === 0 ? (
          <Empty>No resources to graph. Run a scan or seed demo data.</Empty>
        ) : (
          <InfraGraph graph={data} search={search} onSelect={setSelectedId} />
        )}
      </div>

      <ResourceDetailDrawer
        resourceId={selectedId}
        onClose={() => setSelectedId(null)}
        onNavigate={(id) => setSelectedId(id)}
      />
    </div>
  );
}
