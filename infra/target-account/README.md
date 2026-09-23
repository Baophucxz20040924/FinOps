# Target-account IAM module

Deploys the read-only role that **AWS Infrastructure Explorer** assumes to scan
this AWS account. Apply this in each account you want to scan.

## What it creates

- An IAM role (`InfraExplorerReadOnly` by default) trusted **only** by the
  platform's worker role, and **only** when the correct `ExternalId` is
  presented (confused-deputy mitigation).
- A least-privilege policy granting **read-only** access (`Describe*` / `List*`
  / `Get*`) to the services the scanner inspects, plus `cloudwatch:GetMetricData`
  and `ce:GetCostAndUsage`. No mutating actions are granted.

## Usage

1. In the platform, register the account. It gives you a `roleArn` to create and
   a generated `ExternalId`.
2. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in:
   - `control_account_principal_arn` — the platform worker role ARN (shown on the
     registration screen)
   - `external_id` — the generated ExternalId
3. Apply:
   ```bash
   terraform init
   terraform apply
   ```
4. Copy the `role_arn` output back into the platform and click **Verify**.

## Security notes

- No AWS access keys are created or shared in either direction — access is via
  short-lived STS credentials from `sts:AssumeRole`.
- `external_id` is marked sensitive; do not commit `terraform.tfvars`.
- To further tighten access, scope the `resources` in `main.tf` from `*` to
  specific ARNs, or remove services you do not want scanned.
