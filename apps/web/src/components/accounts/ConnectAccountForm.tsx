"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { KNOWN_REGIONS } from "@infra-explorer/domain";
import { api, ApiError, type RegisterAccountResponse } from "../../lib/api";

const ARN_RE = /^arn:aws:iam::(\d{12}):role\/[\w+=,.@/-]+$/;

const INPUT_CLASS =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function ConnectAccountForm({
  onConnected,
}: {
  onConnected: (r: RegisterAccountResponse) => void;
}): ReactNode {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [awsAccountId, setAwsAccountId] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [regions, setRegions] = useState<string[]>(["us-west-2"]);

  const mutation = useMutation({
    mutationFn: () =>
      api.createAccount({ displayName, awsAccountId, roleArn, enabledRegions: regions }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onConnected(r);
      setDisplayName("");
      setAwsAccountId("");
      setRoleArn("");
      setRegions(["us-west-2"]);
    },
  });

  const fieldErrors =
    mutation.error instanceof ApiError ? mutation.error.fieldErrors : undefined;

  // Auto-fill the ARN account segment from the entered account id (convenience).
  const arnMatch = ARN_RE.exec(roleArn);
  const arnMismatch =
    roleArn.length > 0 &&
    arnMatch !== null &&
    awsAccountId.length === 12 &&
    arnMatch[1] !== awsAccountId;

  const toggleRegion = (code: string): void => {
    setRegions((prev) =>
      prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code],
    );
  };

  const canSubmit =
    displayName.trim().length > 0 &&
    /^\d{12}$/.test(awsAccountId) &&
    ARN_RE.test(roleArn) &&
    !arnMismatch &&
    regions.length > 0 &&
    !mutation.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Display name" error={fieldErrors?.displayName?.[0]}>
        <input
          className={INPUT_CLASS}
          placeholder="Production"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>

      <Field label="AWS account ID" error={fieldErrors?.awsAccountId?.[0]}>
        <input
          className={INPUT_CLASS}
          placeholder="123456789012"
          inputMode="numeric"
          maxLength={12}
          value={awsAccountId}
          onChange={(e) =>
            setAwsAccountId(e.target.value.replace(/\D/g, "").slice(0, 12))
          }
        />
      </Field>

      <Field
        label="Read-only role ARN"
        error={
          fieldErrors?.roleArn?.[0] ??
          (arnMismatch ? "ARN account id must match the AWS account ID" : undefined)
        }
      >
        <input
          className={`${INPUT_CLASS} font-mono`}
          placeholder="arn:aws:iam::123456789012:role/InfraExplorerReadOnly"
          value={roleArn}
          onChange={(e) => setRoleArn(e.target.value.trim())}
        />
      </Field>

      <Field label="Regions to scan" error={fieldErrors?.enabledRegions?.[0]}>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {KNOWN_REGIONS.map((r) => (
            <label
              key={r.code}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-sm"
            >
              <input
                type="checkbox"
                checked={regions.includes(r.code)}
                onChange={() => toggleRegion(r.code)}
              />
              <span className="font-mono">{r.code}</span>
            </label>
          ))}
        </div>
      </Field>

      {mutation.isError && !fieldErrors && (
        <p className="text-sm text-red-600">
          {(mutation.error as Error).message}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {mutation.isPending ? "Connecting…" : "Connect account"}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
