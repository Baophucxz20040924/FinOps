"use client";

import { useState, type ReactNode } from "react";
import { useAccount } from "../../lib/account-context";
import type { RegisterAccountResponse } from "../../lib/api";
import { Card } from "../../components/ui";
import { ConnectAccountForm } from "../../components/accounts/ConnectAccountForm";
import { AccountsList } from "../../components/accounts/AccountsList";
import { CopyField } from "../../components/accounts/CopyField";

export default function AccountsPage(): ReactNode {
  const { accounts, isLoading } = useAccount();
  const [connected, setConnected] = useState<RegisterAccountResponse | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">AWS Accounts</h1>
        <p className="text-sm text-neutral-500">
          Connect an account by granting a read-only IAM role. The platform assumes
          the role with short-lived credentials — no keys are stored.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Connect an AWS account">
          <ConnectAccountForm onConnected={setConnected} />
        </Card>

        <div className="space-y-4">
          {connected && <NextSteps result={connected} />}
          <Card title="Connected accounts">
            {isLoading ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : (
              <AccountsList accounts={accounts} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function NextSteps({ result }: { result: RegisterAccountResponse }): ReactNode {
  const { account, externalId, workerRoleArn } = result;
  const principal = workerRoleArn || "arn:aws:iam::<CONTROL_ACCOUNT_ID>:role/InfraExplorerWorkerRole";
  const trustPolicy = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: principal },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": externalId } },
        },
      ],
    },
    null,
    2,
  );

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h2 className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        Account “{account.displayName}” created — finish setup
      </h2>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
        <li>
          Create the role <code>{account.roleArn.split("/").pop()}</code> in account{" "}
          {account.awsAccountId} with the trust policy below.
        </li>
        <li>Then click <strong>Verify</strong> on the account in the list.</li>
      </ol>
      <div className="space-y-3">
        <CopyField label="ExternalId" value={externalId} />
        <CopyField label="Trust policy" value={trustPolicy} multiline />
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Tip: the <code>infra/target-account</code> Terraform module applies this
          role for you — pass this ExternalId and the worker role ARN as variables.
        </p>
      </div>
    </div>
  );
}
