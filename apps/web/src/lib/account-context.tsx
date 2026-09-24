"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Account } from "@infra-explorer/domain";
import { api } from "./api";

interface AccountContextValue {
  accounts: Account[];
  isLoading: boolean;
  error: unknown;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string) => void;
  selectedAccount: Account | null;
  region: string | null; // null = all enabled regions
  setRegion: (region: string | null) => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const STORAGE_KEY = "infra-explorer.accountId";

export function AccountProvider({ children }: { children: ReactNode }): ReactNode {
  const {
    data: accounts = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });

  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(
    null,
  );
  const [region, setRegion] = useState<string | null>(null);

  // Restore persisted selection, else default to the first account.
  useEffect(() => {
    if (accounts.length === 0) return;
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    const valid = accounts.find((a) => a.id === stored);
    setSelectedAccountIdState(valid ? valid.id : accounts[0]!.id);
  }, [accounts]);

  const setSelectedAccountId = (id: string): void => {
    setSelectedAccountIdState(id);
    setRegion(null);
    if (typeof window !== "undefined")
      window.localStorage.setItem(STORAGE_KEY, id);
  };

  const selectedAccount =
    accounts.find((a) => a.id === selectedAccountId) ?? null;

  const value = useMemo<AccountContextValue>(
    () => ({
      accounts,
      isLoading,
      error,
      selectedAccountId,
      setSelectedAccountId,
      selectedAccount,
      region,
      setRegion,
    }),
    [accounts, isLoading, error, selectedAccountId, selectedAccount, region],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
