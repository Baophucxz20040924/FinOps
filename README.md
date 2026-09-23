# AWS Infrastructure Explorer

A lightweight, **read-only** internal platform that connects to an AWS account via a
read-only IAM role, scans it, and produces:

1. A visual **infrastructure map** (CloudFront → ALB → ECS → RDS, …)
2. A searchable **resource explorer** table
3. Evidence-backed **waste findings** (idle EC2, unattached EBS, unused EIPs, …)

It never mutates AWS. See [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md) for the full design.

## Prerequisites

- Node.js ≥ 20 (developed on v24)
- pnpm 9 (`npm install -g pnpm@9.15.0`, or via corepack)
- Docker Desktop (for local Postgres)

## Quick start

```bash
pnpm install
cp .env.example .env

# start local Postgres and apply migrations
pnpm db:up
pnpm db:migrate

# run everything in dev
pnpm dev
```

Individual services:

```bash
pnpm --filter @infra-explorer/api dev      # API on :4000  (health: /api/v1/health)
pnpm --filter @infra-explorer/web dev      # Web on :3000
pnpm --filter @infra-explorer/worker dev   # background worker
```

## Repository layout

```text
apps/
  api/       NestJS REST API (/api/v1)
  worker/    scan pipeline worker (pg-boss consumer)
  web/       Next.js frontend (Overview / Map / Resource Explorer)
packages/
  domain/    shared TypeScript types (single source of truth)
  db/        Drizzle schema + migrations + client
  shared/    logger, errors, config helpers
cli/         infra-explorer CLI (thin API client)
infra/
  target-account/   Terraform: read-only role customers apply
docs/        (architecture, runbooks)
```

## Security model (summary)

- Cross-account access is **`sts:AssumeRole` only**, with a mandatory per-account `ExternalId`.
- No long-lived AWS keys are stored anywhere.
- The target role grants only read-only actions. Deploy it with the
  [`infra/target-account`](./infra/target-account) Terraform module.

See `ARCHITECTURE_PLAN.md` §N for the full security design.
