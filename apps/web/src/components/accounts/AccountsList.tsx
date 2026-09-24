"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { Account } from "@infra-explorer/domain";
import { api } from "../../lib/api";
import { AccountStatusBadge, Empty } from "../ui";

export function AccountsList({
  accounts,
}: {
  accounts: Account[];
}): ReactNode {
  if (accounts.length === 0) {
    return <Empty>No accounts connected yet. Use the form to connect one.</Empty>;
  }
  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
    </ul>
  );
}

function AccountRow({ account }: { account: Account }): ReactNode {
  const qc = useQueryClient();
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const verify = useMutation({
    mutationFn: () => api.verifyAccount(account.id),
    onSuccess: (r) => {
      setVerifyMsg(r.status === "ACTIVE" ? "Verified — role assumed." : (r.error ?? "Invalid"));
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => setVerifyMsg((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{account.displayName}</span>
          <AccountStatusBadge status={account.status} />
        </div>
        <div className="text-xs text-neutral-500">
          {account.awsAccountId} · {account.enabledRegions.join(", ") || "no regions"}
        </div>
        {verifyMsg && (
          <div
            className={
              "mt-1 text-xs " +
              (account.status === "ACTIVE" ? "text-green-600" : "text-amber-600")
            }
          >
            {verifyMsg}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => verify.mutate()}
          disabled={verify.isPending}
          className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {verify.isPending ? "Verifying…" : "Verify"}
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {remove.isPending ? "Removing…" : "Confirm"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded border border-neutral-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-neutral-700 dark:hover:bg-red-950/30"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
