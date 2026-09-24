"use client";

import { useState, type ReactNode } from "react";

/** A read-only value (inline or multiline code block) with a copy button. */
export function CopyField({
  label,
  value,
  multiline = false,
}: {
  label?: string;
  value: string;
  multiline?: boolean;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };

  return (
    <div className="space-y-1">
      {label && (
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {label}
        </div>
      )}
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre className="min-w-0 flex-1 overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-950">
            {value}
          </pre>
        ) : (
          <code className="min-w-0 flex-1 truncate rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-950">
            {value}
          </code>
        )}
        <button
          onClick={copy}
          className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
