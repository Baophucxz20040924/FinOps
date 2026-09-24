# AWS Infrastructure Explorer

A lightweight, **read-only** internal platform that connects to an AWS account through a
read-only IAM role, scans it, and turns "nobody actually knows what's running in this
account" into a queryable, visual map:

1. **Overview** — resource counts by service, totals, (cost & waste — coming soon)
2. **Infrastructure Map** — an interactive graph of how resources connect
   (EC2 → subnet / security group / VPC, EBS → EC2, NAT → EIP, …)
3. **Resource Explorer** — a searchable, filterable table with a detail drawer

It **never mutates AWS**. Access is exclusively via short-lived `sts:AssumeRole`
credentials with a mandatory per-account `ExternalId` — no long-lived keys, anywhere.

The full design is in [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md); guidance for
working in the repo is in [`CLAUDE.md`](./CLAUDE.md).

---

## Status

| Area | State |
|---|---|
| Account onboarding (register + verify assume-role) | ✅ built |
| Scanners: EC2, EBS, VPC (subnets, SGs, route tables, IGW, NAT, EIP) | ✅ built |
| Idempotent persistence (upsert + scope-gated soft-delete) | ✅ built |
| Relationship graph engine | ✅ built |
| Async scan pipeline (`POST /scans` → pg-boss → worker) | ✅ built |
| Read APIs + 3 frontend pages + **Scan** button | ✅ built |
| Cost engine (Cost Explorer + pricing estimates) | ⛔ not yet — Overview "Estimated cost" is a placeholder |
| Findings / waste rules engine | ⛔ not yet — Overview "Potential waste" is a placeholder |
| More services (RDS, ECS, ALB, S3, Lambda, SQS, CloudFront) | ⛔ not yet (MVP scans EC2/EBS/VPC) |
| Platform login / auth | ⛔ not yet (internal-tool assumption) |

You can explore the whole product today using the built-in **demo data**, or point it at
a real AWS account once you deploy the read-only role.

---

## Prerequisites

- **Node.js** ≥ 20 (developed on v24)
- **pnpm** 9 — `npm install -g pnpm@9.15.0`
- **Docker Desktop** running (for local Postgres)

---

## Quick start (demo data — no AWS needed)

Run everything from the repo root.

```bash
# 1. Install
pnpm install

# 2. Start Postgres.  Host port 55432 avoids clashing with a local Postgres on 5432.
POSTGRES_HOST_PORT=55432 pnpm db:up

# 3. Point tools at that DB (IPv4 127.0.0.1 — see "Gotchas" below).
#    bash:
export DATABASE_URL="postgresql://infra:infra@127.0.0.1:55432/infra_explorer"
#    PowerShell:
#    $env:DATABASE_URL="postgresql://infra:infra@127.0.0.1:55432/infra_explorer"

# 4. Create the schema and load a realistic demo topology
pnpm db:migrate
pnpm --filter @infra-explorer/db db:seed

# 5. Start the API and the web app (separate terminals; DATABASE_URL must be set in each)
API_PORT=4000 CORS_ORIGINS=http://localhost:3000 pnpm --filter @infra-explorer/api dev
NEXT_PUBLIC_API_BASE=http://localhost:4000/api/v1 pnpm --filter @infra-explorer/web dev
```

Open **http://localhost:3000**. The demo account ("Production (demo)") includes an
**unattached EBS volume** and an **unused Elastic IP** — the waste a findings engine will
flag later.

> If your machine has no Postgres on 5432, you can drop `POSTGRES_HOST_PORT=55432` and use
> `postgresql://infra:infra@localhost:5432/infra_explorer` instead.

---

## Running the services

Each service is a workspace package; all backend services read `DATABASE_URL` from the
environment.

```bash
# API — REST at http://localhost:4000/api/v1 (health: /api/v1/health)
API_PORT=4000 CORS_ORIGINS=http://localhost:3000 AWS_REGION=us-west-2 \
  pnpm --filter @infra-explorer/api dev

# Web — Next.js at http://localhost:3000
NEXT_PUBLIC_API_BASE=http://localhost:4000/api/v1 \
  pnpm --filter @infra-explorer/web dev

# Worker — consumes scan jobs (only needed for live scans, not demo data)
AWS_REGION=us-west-2 pnpm --filter @infra-explorer/worker dev
```

---

## Scanning a real AWS account

1. **Register the account** (returns a generated `externalId` and the worker role ARN to
   trust):
   ```bash
   curl -X POST http://localhost:4000/api/v1/accounts -H "Content-Type: application/json" -d '{
     "displayName": "Production",
     "awsAccountId": "123456789012",
     "roleArn": "arn:aws:iam::123456789012:role/InfraExplorerReadOnly",
     "enabledRegions": ["us-west-2"]
   }'
   ```
2. **Deploy the read-only role** in the target account with the Terraform module,
   supplying the `externalId` + worker role ARN from step 1:
   ```bash
   cd infra/target-account && terraform init && terraform apply
   ```
3. **Verify** the platform can assume it:
   ```bash
   curl -X POST http://localhost:4000/api/v1/accounts/<id>/verify   # → ACTIVE or INVALID
   ```
4. Make sure the **worker** is running, then click **Scan** in the UI (or
   `POST /api/v1/scans`). The scan runs asynchronously; status transitions
   `QUEUED → RUNNING → SUCCESS | PARTIAL_SUCCESS | FAILED` and the views refresh when it
   finishes.

---

## Repository layout

```text
apps/
  api/                 NestJS REST API (/api/v1): accounts, scans, resources, graph, overview
  worker/              scan orchestrator + pg-boss consumer (discover → persist → relate)
  web/                 Next.js 15 + Tailwind + React Query + React Flow (3 pages)
packages/
  domain/              shared TypeScript types — the single source of truth
  db/                  Drizzle schema, migrations, client, repositories, demo seed
  aws-scanner/         STS assume-role, retry/backoff, pagination, per-service scanners
  relationship-engine/ derives + persists typed edges between resources
  shared/              structured logger (pino), typed errors, config, queue constants
cli/                   infra-explorer CLI (thin API client — scaffolded)
infra/
  target-account/      Terraform: the read-only role an account owner applies
ARCHITECTURE_PLAN.md   full architecture, schema, phasing, backlog
```

---

## Architecture in one paragraph

TypeScript end-to-end, so scanner / normalizer / relationship / domain logic is written
**once** and shared across the API, worker, and CLI. **PostgreSQL is the only stateful
dependency** — resources, relationships, and the job queue (via **pg-boss**) all live in it
(no Redis, no SQS, no graph DB for the MVP). A single `resources` table (common columns +
`jsonb metadata`) backs both the table and the graph; **relationships are computed once per
scan and stored explicitly**. Scans are asynchronous and partial-failure tolerant: one
throttled service yields `PARTIAL_SUCCESS`, not a failed scan, and never wrongly deletes
resources it couldn't authoritatively re-list.

---

## Common commands

```bash
pnpm build        # build every package/app (Turborepo, respects the dep graph)
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # run all tests (serialized; DB-gated tests run only if DATABASE_URL is set)

pnpm db:up        # start local Postgres (respects POSTGRES_HOST_PORT)
pnpm db:down      # stop Postgres  (add `docker compose down -v` to wipe the data volume)
pnpm db:generate  # generate a Drizzle migration from schema changes
pnpm db:migrate   # apply migrations to DATABASE_URL

pnpm --filter @infra-explorer/db db:seed   # (re)load the demo topology
```

---

## Testing

- **Unit tests** (Jest-style via **vitest**) run with no AWS and no database — AWS calls
  are mocked with `aws-sdk-client-mock`; pure logic (normalizers, rules, key/serialization
  helpers) is fixture-tested.
- **DB-gated integration tests** exercise real Postgres (idempotent upsert, scope-gated
  soft-delete, the relationship engine, the scan orchestrator with mocked AWS). They are
  **skipped unless `DATABASE_URL` is set**, so CI never needs a database or AWS account.
  These tests **truncate tables**, so they run against a dedicated **`<name>_test`**
  database derived from `DATABASE_URL` (e.g. `infra_explorer` → `infra_explorer_test`) —
  they never touch the app database. Set it up once, then run:
  ```bash
  # one-time: create + migrate the test database
  docker exec infra-explorer-postgres psql -U infra -d infra_explorer \
    -c "CREATE DATABASE infra_explorer_test"
  DATABASE_URL="postgresql://infra:infra@127.0.0.1:55432/infra_explorer_test" \
    pnpm --filter @infra-explorer/db db:migrate

  # run the suite (DB tests auto-target the *_test sibling of DATABASE_URL)
  DATABASE_URL="postgresql://infra:infra@127.0.0.1:55432/infra_explorer" pnpm test
  ```
  Override the target explicitly with `TEST_DATABASE_URL` if you prefer.
- CI must never require a real AWS account.

---

## Security model (summary)

- Cross-account access is **`sts:AssumeRole` only**, with a mandatory per-account
  `ExternalId` (confused-deputy mitigation). No long-lived AWS keys are stored anywhere.
- User-supplied role ARNs are strictly validated before any `AssumeRole` call.
- The target role grants only read-only actions (`Describe*`/`List*`/`Get*` +
  `cloudwatch:GetMetricData` + `ce:GetCostAndUsage`). Deploy it with the
  [`infra/target-account`](./infra/target-account) Terraform module.

See `ARCHITECTURE_PLAN.md` §N for the full security design.

---

## Gotchas & troubleshooting

- **`password authentication failed` connecting to Postgres.** `localhost` may resolve to
  IPv6 `::1`, where a *local* Postgres install can be listening — not the Docker container.
  Use `127.0.0.1:55432` in `DATABASE_URL` (and start the container with
  `POSTGRES_HOST_PORT=55432`).
- **Scan stays `QUEUED` forever.** The **worker** isn't running — start it
  (`pnpm --filter @infra-explorer/worker dev`). Demo data (`db:seed`) needs no worker.
- **Every backend command needs `DATABASE_URL`** exported in that terminal.
- **`CREATE EXTENSION pg_trgm` permission error on RDS.** Run migrations as
  `rds_superuser`/master, or create the extension out-of-band before migrating.
