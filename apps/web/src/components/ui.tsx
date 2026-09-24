import type { ReactNode } from "react";

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={
        "rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 " +
        className
      }
    >
      {title && (
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-500">
      {children}
    </div>
  );
}

const STATE_STYLES: Record<string, string> = {
  running: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  available:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  "in-use":
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  attached:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  stopped:
    "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  unused: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  detached:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

export function StateBadge({ state }: { state: string | null }): ReactNode {
  if (!state) return <span className="text-neutral-400">—</span>;
  const cls =
    STATE_STYLES[state] ??
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {state}
    </span>
  );
}
