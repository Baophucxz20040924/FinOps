"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useAccount } from "../../lib/account-context";
import { api } from "../../lib/api";
import { Empty, StateBadge } from "../../components/ui";
import { ResourceDetailDrawer } from "../../components/ResourceDetailDrawer";

export default function ResourcesPage(): ReactNode {
  const { selectedAccountId, region } = useAccount();
  const [search, setSearch] = useState("");
  const [service, setService] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["resources", selectedAccountId, region, service, search, page],
    queryFn: () =>
      api.resources({
        accountId: selectedAccountId!,
        region: region ?? undefined,
        service: service || undefined,
        search: search || undefined,
        page,
      }),
    enabled: Boolean(selectedAccountId),
  });

  if (!selectedAccountId)
    return <Empty>Register and select an AWS account to begin.</Empty>;

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="w-64 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={service}
          onChange={(e) => {
            setService(e.target.value);
            setPage(1);
          }}
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
        <span className="ml-auto text-sm text-neutral-500">
          {data ? `${data.total} resources` : ""}
        </span>
      </div>

      {isLoading ? (
        <Empty>Loading resources…</Empty>
      ) : error ? (
        <Empty>Failed: {(error as Error).message}</Empty>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Empty>No resources match. Run a scan or seed the demo data.</Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-100 text-left dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 font-medium">Service</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Region</th>
                <th className="px-3 py-2 font-medium">Env</th>
              </tr>
            </thead>
            <tbody>
              {data!.items.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                >
                  <td className="px-3 py-2">{r.service}</td>
                  <td className="px-3 py-2 font-medium">
                    {r.name ?? <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{r.type}</td>
                  <td className="px-3 py-2">
                    <StateBadge state={r.state} />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{r.region}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {r.environment ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button
            className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <span className="text-neutral-500">
            Page {page} / {pageCount}
          </span>
          <button
            className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      <ResourceDetailDrawer
        resourceId={selectedId}
        onClose={() => setSelectedId(null)}
        onNavigate={(id) => setSelectedId(id)}
      />
    </div>
  );
}
