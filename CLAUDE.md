# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**AWS Infrastructure Explorer** — a lightweight, **read-only** internal platform that
assumes a read-only IAM role in a target AWS account, scans it, and produces a visual
infrastructure map, a searchable resource table, and evidence-backed waste findings.
The full design lives in `ARCHITECTURE_PLAN.md` — read it before making architectural
decisions; it is the source of truth for scope, schema, and phasing.

## Non-negotiable product principles

- **Read-only, always.** The platform never mutates AWS. The target IAM policy grants only
  `Describe*`/`List*`/`Get*` + `cloudwatch:GetMetricData` + `ce:GetCostAndUsage`.
- **No long-lived AWS keys.** Cross-account access is exclusively `sts:AssumeRole` with a
  mandatory per-account `ExternalId`.
- **Deterministic rules before AI.** Every finding carries structured `evidence` and a
  `confidence` of `VERIFIED | INFERRED | ESTIMATED | UNKNOWN`. Never present estimated
  savings as guaranteed.
- **Never conflate cost numbers.** Actual (Cost Explorer) vs Estimated (pricing model) vs
  Potential savings (from findings) are always labeled distinctly.

## Commands

Run from the repo root (uses pnpm workspaces + Turborepo):

```bash
pnpm install            # install all workspace deps
pnpm build              # build every package/app (turbo, respects dep graph)
pnpm typecheck          # tsc --noEmit across the workspace
pnpm test               # run tests across the workspace
pnpm dev                # run all dev servers (persistent)

pnpm db:up              # start local Postgres (docker compose) — needs Docker Desktop running
pnpm db:down            # stop local Postgres
pnpm db:generate        # generate a Drizzle migration from schema changes
pnpm db:migrate         # apply migrations to DATABASE_URL
```

Scope a command to one package with a filter, e.g.:

```bash
pnpm --filter @infra-explorer/db db:generate
pnpm --filter @infra-explorer/api dev
```

There is no test runner wired yet (packages have placeholder `test` scripts). When adding
tests, use the strategy in `ARCHITECTURE_PLAN.md` §S (Jest unit tests over fixtures,
`aws-sdk-client-mock` for scanner integration tests, Testcontainers/Dockerized Postgres for
repository tests). Do not require a real AWS account for CI tests.

## Architecture (big picture)

TypeScript everywhere so the scanner/normalizer/rules/domain logic is written **once** and
shared by the API, worker, and CLI — never reimplemented per surface.

- `packages/domain` — **the load-bearing package.** All shared types (`Resource`,
  `Relationship`, `Scan`, `Finding`, `CostSnapshot`, etc.). A schema change is one edit here,
  not four. Imported by everything.
- `packages/db` — Drizzle schema + migrations + `createDb()` client (pg Pool). Drizzle was
  chosen over Prisma because later phases need hand-written SQL (GIN/trigram indexes,
  `metrics` monthly partitioning) that Drizzle handles cleanly.
- `packages/shared` — structured logger (pino, with credential redaction at the transport
  level), typed `AppError`s, env config helpers.
- `packages/aws-scanner` *(not yet created)* — one `ResourceScanner` per service, tagged
  `REGIONAL`/`GLOBAL`. Returns partial results + errors rather than throwing, so one
  throttled service yields `PARTIAL_SUCCESS`, not a failed scan.
- `packages/rules`, `packages/cost` *(not yet created)* — pure-function rule engine and cost
  estimation.
- `apps/api` — NestJS REST API under `/api/v1`. Enqueues scans (returns 202), serves
  resources/graph/findings/cost.
- `apps/worker` — long-running process; consumes scan jobs (pg-boss, Postgres-native queue —
  no Redis/SQS for MVP) and runs the pipeline: discover → normalize → relate → metrics →
  rules → cost → persist.
- `apps/web` — Next.js 15 (App Router). Three pages only: Overview, Infrastructure Map
  (React Flow + dagre), Resource Explorer. Resist adding a fourth.
- `cli` — commander-based CLI. **A thin client over the REST API**, not a second scanner.
- `infra/target-account` — Terraform the account owner applies to create the read-only role.
- `infra/control-account` *(not yet created)* — Terraform for the platform's own deployment
  (ECS Fargate api+worker, RDS, ALB, CloudFront+S3).

Key modeling decisions (see `ARCHITECTURE_PLAN.md` §D/§E/§G):
- **One `resources` table** with common columns + `jsonb metadata`, not a table per AWS type,
  so the graph and table views share one query path.
- **Relationships are stored explicitly** (computed once per scan from direct AWS API fields),
  not derived at read time.
- **`metrics` stores daily rollups**, never raw CloudWatch datapoints; partitioned monthly.

## Conventions

- Packages build to `dist/` via `tsc` (CommonJS) for Node compatibility with NestJS; `apps/web`
  uses the Next.js bundler. Shared packages expose `main`/`types` pointing at `dist/`.
- Cross-package imports use the workspace name (`@infra-explorer/domain`), never relative paths
  across package boundaries.
- Scanners must never throw on a single-service API failure — collect errors and return partial
  results so the orchestrator can record `THROTTLED`/`FAILED` per service.
- Validate any user-supplied AWS role ARN against `^arn:aws:iam::\d{12}:role/[\w+=,.@-]+$`
  before ever calling `AssumeRole` with it.

## Status

Foundation is in place: monorepo, domain types, `accounts`/`scans` schema, minimal
api/worker/web/cli, and the target-account Terraform module. Follow the phased plan in
`ARCHITECTURE_PLAN.md` §W and the `INFRA-xxx` backlog in §X for what comes next.
