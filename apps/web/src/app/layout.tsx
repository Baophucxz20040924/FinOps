import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { QueryProvider } from "../lib/query-provider";
import { AccountProvider } from "../lib/account-context";
import { AppShell } from "../components/AppShell";

export const metadata: Metadata = {
  title: "AWS Infrastructure Explorer",
  description: "Read-only visual overview of AWS infrastructure",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <AccountProvider>
            <AppShell>{children}</AppShell>
          </AccountProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
