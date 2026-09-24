"use client";

import type { ReactNode } from "react";
import { useAccount } from "../lib/account-context";

export function AccountRegionSwitcher(): ReactNode {
  const {
    accounts,
    selectedAccount,
    selectedAccountId,
    setSelectedAccountId,
    region,
    setRegion,
  } = useAccount();

  if (accounts.length === 0) {
    return (
      <span className="text-sm text-neutral-500">No accounts registered</span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Account"
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        value={selectedAccountId ?? ""}
        onChange={(e) => setSelectedAccountId(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.displayName} ({a.awsAccountId})
          </option>
        ))}
      </select>

      <select
        aria-label="Region"
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        value={region ?? ""}
        onChange={(e) => setRegion(e.target.value || null)}
        disabled={!selectedAccount}
      >
        <option value="">All regions</option>
        {(selectedAccount?.enabledRegions ?? []).map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}
