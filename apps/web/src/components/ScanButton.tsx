"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import type { ScanStatus } from "@infra-explorer/domain";
import { useAccount } from "../lib/account-context";
import { api } from "../lib/api";

const TERMINAL: ScanStatus[] = ["SUCCESS", "PARTIAL_SUCCESS", "FAILED"];

export function ScanButton(): ReactNode {
  const { selectedAccountId, region } = useAccount();
  const qc = useQueryClient();
  const [scanId, setScanId] = useState<string | null>(null);

  const trigger = useMutation({
    mutationFn: () =>
      api.triggerScan(
        selectedAccountId!,
        region ? [region] : undefined,
      ),
    onSuccess: (r) => setScanId(r.scanId),
  });

  // Poll the scan while it runs; refresh views when it finishes.
  const { data: scan } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => api.scan(scanId!),
    enabled: Boolean(scanId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && TERMINAL.includes(s) ? false : 2000;
    },
  });

  const running =
    trigger.isPending ||
    (Boolean(scanId) && !!scan && !TERMINAL.includes(scan.status));

  // When a scan reaches a terminal state, refresh the data views once.
  const terminalStatus =
    scan && TERMINAL.includes(scan.status) ? scan.status : null;
  useEffect(() => {
    if (!terminalStatus) return;
    void qc.invalidateQueries({ queryKey: ["overview"] });
    void qc.invalidateQueries({ queryKey: ["resources"] });
    void qc.invalidateQueries({ queryKey: ["graph"] });
  }, [terminalStatus, qc]);

  const statusLabel = trigger.isPending
    ? "Queuing…"
    : running
      ? `Scanning… (${scan?.status ?? "QUEUED"})`
      : scan
        ? scan.status
        : null;

  return (
    <div className="flex items-center gap-2">
      {statusLabel && (
        <span className="text-sm text-neutral-500">{statusLabel}</span>
      )}
      <button
        onClick={() => trigger.mutate()}
        disabled={!selectedAccountId || running}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {running ? "Scanning…" : "Scan"}
      </button>
      {trigger.isError && (
        <span className="text-sm text-red-600">
          {(trigger.error as Error).message}
        </span>
      )}
    </div>
  );
}
