"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAccount } from "../../lib/account-context";
import { api } from "../../lib/api";
import { Card, Empty } from "../../components/ui";

export default function OverviewPage(): ReactNode {
  const { selectedAccount, selectedAccountId, region } = useAccount();

  const { data, isLoading, error } = useQuery({
    queryKey: ["overview", selectedAccountId, region],
    queryFn: () => api.overview(selectedAccountId!, region ?? undefined),
    enabled: Boolean(selectedAccountId),
  });

  if (!selectedAccountId)
    return <Empty>Register and select an AWS account to begin.</Empty>;
  if (isLoading) return <Empty>Loading overview…</Empty>;
  if (error)
    return <Empty>Failed to load overview: {(error as Error).message}</Empty>;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">AWS Infrastructure</h1>
        <p className="text-sm text-neutral-500">
          Account: {selectedAccount?.displayName} · Region: {region ?? "all"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card title="Total resources">
          <div className="text-3xl font-semibold tabular-nums">
            {data?.totalResources ?? 0}
          </div>
        </Card>
        <Card title="Estimated cost">
          <div className="text-3xl font-semibold text-neutral-400">—</div>
          <p className="mt-1 text-xs text-neutral-500">
            Cost engine not yet enabled
          </p>
        </Card>
        <Card title="Potential waste">
          <div className="text-3xl font-semibold text-neutral-400">—</div>
          <p className="mt-1 text-xs text-neutral-500">
            Findings engine not yet enabled
          </p>
        </Card>
      </div>

      <Card title="Resources by service">
        {(data?.countsByService.length ?? 0) === 0 ? (
          <p className="text-sm text-neutral-500">
            No resources yet. Run a scan (or seed the demo data).
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data!.countsByService.map((c) => (
                <tr
                  key={c.service}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                >
                  <td className="py-1.5 font-medium">{c.service}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
