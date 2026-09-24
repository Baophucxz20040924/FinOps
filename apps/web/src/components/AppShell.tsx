"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountRegionSwitcher } from "./AccountRegionSwitcher";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/graph", label: "Infrastructure Map" },
  { href: "/resources", label: "Resource Explorer" },
];

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-6">
          <span className="font-semibold tracking-tight">
            AWS Infrastructure Explorer
          </span>
          <nav className="flex gap-1">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "rounded px-3 py-1.5 text-sm transition-colors " +
                    (active
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <AccountRegionSwitcher />
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
