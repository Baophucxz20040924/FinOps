# AWS Infrastructure Explorer — Architecture & Implementation Plan

Status: Draft v1 — pre-implementation
Owner: (you)
Author: Claude (Senior Staff Engineer / AWS SA / FinOps Architect role)

Assumptions are explicitly labeled `ASSUMPTION:` throughout. Validate these before locking scope.

---

## A. Executive Summary

AWS Infrastructure Explorer is an internal, read-only platform that lets an engineer point at an AWS account (via an assumed IAM role), trigger a scan, and get back:

1. A visual graph of how resources connect (CloudFront → ALB → ECS → RDS, etc.)
2. A searchable table of every discovered resource with state, cost, and tags
3. A findings feed of deterministic, evidence-backed waste/risk signals (idle EC2, unattached EBS, unused EIPs, etc.)

It is explicitly **not**: a cost-allocation/billing tool, a CMDB replacement, a security-posture scanner, an IaC tool, or an automation/remediation platform. It never mutates AWS state. Its value is turning "nobody actually knows what's running in this account" into a queryable, visual, evidence-based map in under a minute of setup (one IAM role) and a few minutes of scan time.

Core design bets:
- **Read-only, assume-role, short-lived STS credentials only** — no long-lived keys, ever.
- **Deterministic rules before AI** — every finding must show its evidence; AI (later) explains findings, never generates them from nothing and never acts on AWS.
- **PostgreSQL as the only stateful dependency for MVP** — resources, relationships, metrics, findings, and the job queue all live there. No Redis, no SQS, no Kafka, no graph DB until proven insufficient.
- **One language across the stack** — TypeScript everywhere (web, API, worker, CLI, scanner packages) so scanning logic is written once and shared, not reimplemented per surface.
- **Scans are async, resumable, and partial-success-tolerant** — one throttled AWS service must not sink the whole scan.

---

## B. Recommended Architecture

```text
                                   ┌─────────────────────────┐
                                   │        Engineer          │
                                   │   (browser)      (CLI)   │
                                   └────────────┬─────┬───────┘
                                                │     │
                                     HTTPS      │     │  HTTPS (same API)
                                                ▼     ▼
                          ┌───────────────────────────────────────┐
                          │              CloudFront                │
                          └───────────────────┬───────────────────┘
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         ▼                                           ▼
              ┌─────────────────────┐                     ┌─────────────────────┐
              │   Next.js Frontend   │                     │   ALB (api.*)        │
              │  (S3 + CF, static)   │                     └──────────┬──────────┘
              └─────────────────────┘                                 │
                                                                       ▼
                                                          ┌─────────────────────────┐
                                                          │   ECS Fargate: API       │
                                                          │   (NestJS, stateless)    │
                                                          └────────────┬────────────┘
                                                                       │
                                    enqueue scan job                  │ read/write
                                          │                           ▼
                                          │              ┌─────────────────────────┐
                                          └─────────────▶│   PostgreSQL (RDS)       │◀───────────┐
                                                          │  resources / relations   │            │
                                                          │  metrics / findings      │            │
                                                          │  scans / job queue       │            │
                                                          └────────────┬────────────┘            │
                                                                       │ dequeue (pg-boss)         │
                                                                       ▼                           │
                                                          ┌─────────────────────────┐              │
                                                          │  ECS Fargate: Worker     │              │
                                                          │  (scanner + rules +      │──────────────┘
                                                          │   metrics + cost engine) │
                                                          └────────────┬────────────┘
                                                                       │ sts:AssumeRole
                                                                       ▼
                                                     ┌───────────────────────────────────┐
                                                     │   Target AWS Account(s)            │
                                                     │   role: InfraExplorerReadOnly       │
                                                     │   (EC2/RDS/ECS/S3/... describe*,    │
                                                     │    CloudWatch GetMetricData,         │
                                                     │    Cost Explorer GetCostAndUsage)    │
                                                     └───────────────────────────────────┘
```

Everything the platform itself runs lives in **one** AWS "control" account. Target/scanned accounts are separate and only ever grant a read-only role back to the control account's worker role (cross-account `sts:AssumeRole`, no keys shared either direction).

---

## C. Technology Choices

| Area | Choice | Alternatives considered | Why chosen |
|---|---|---|---|
| Backend framework | **NestJS (TypeScript)** | FastAPI + boto3 | Single language across api/worker/CLI/scanner packages means the scanner, normalizer, relationship engine, and rule engine are written **once** and imported everywhere. boto3 has nicer AWS ergonomics than AWS SDK v3 in isolation, but that advantage is outweighed by not having to duplicate domain logic in Python and TS for the frontend/CLI. NestJS gives DI, module boundaries, and testability without inventing your own structure. |
| AWS SDK | **AWS SDK for JavaScript v3** (modular clients) | boto3 (would require Python backend) | Matches TS choice; v3 clients are modular (only pull in `@aws-sdk/client-ec2`, etc.), tree-shakeable, supports `fromTemporaryCredentials` for clean role assumption. |
| Database | **PostgreSQL (RDS)** | DynamoDB, Neo4j/graph DB | Relational + JSONB gives structured querying (filter table) AND flexible per-service metadata in one engine. Graph queries for MVP scale (thousands–low hundreds-of-thousands of nodes/edges) are fine with recursive CTEs / adjacency queries; a dedicated graph DB is unjustified operational overhead at this scale. |
| Job queue | **pg-boss (Postgres-native queue)** | SQS, BullMQ+Redis, Step Functions | MVP has one worker type and no cross-service fan-out need. pg-boss runs entirely inside the Postgres you already operate — zero new infra, transactional enqueue (job + scan row in one transaction), built-in retry/backoff. SQS/BullMQ are better long-term multi-worker/multi-queue answers; revisit at V2 when scan volume or worker fleet size justifies it (see §Y risks). |
| Frontend | **Next.js + React + TypeScript + Tailwind** | Remix, plain Vite SPA | Requested; also gives you SSG for the shell and easy static hosting via S3+CloudFront for the parts that don't need SSR (this app is basically API-driven SPA behavior — Next.js used mostly for routing/DX, not SSR of AWS data). |
| Graph visualization | **React Flow** | Cytoscape.js, D3 force graph | Requested, and correct choice: React Flow gives node/edge primitives, zoom/pan/selection for free, integrates naturally with React state/detail-drawer patterns. Pair with **dagre** or **elkjs** for automatic hierarchical layout (React Flow itself has no layout algorithm). |
| Monorepo tooling | **pnpm workspaces + Turborepo** | Nx, Lerna | Simple, fast, minimal config; Turborepo's task caching matters once `packages/aws-scanner` and `packages/domain` are shared by 3+ apps. |
| IaC | **Terraform** | AWS CDK, CloudFormation | ASSUMPTION: no strong existing preference stated. Terraform is the most portable / broadly-known choice for a small ops-experienced team; CDK (TS) is a reasonable alternative given the TS-everywhere stack — call this out as an open decision, default to Terraform. |
| Auth (platform login) | **OIDC via existing IdP (e.g. Okta/Google Workspace)** or simple email+password for true MVP | Auth0, Cognito | ASSUMPTION: this is an internal tool for a small team; start with a single hard-coded admin user or basic email/password (bcrypt) behind the VPC/ALB, defer SSO integration to V1 unless an IdP is already mandated by IT policy. |
| Metrics/observability | **CloudWatch (platform's own) + structured JSON logs** | Datadog, Prometheus/Grafana | Keep the platform's own observability inside AWS-native tooling to avoid another vendor for an internal tool; revisit only if the team already standardizes on something else. |

---

## D. Domain Model

```text
Account
  id (uuid)
  awsAccountId (string, 12-digit)
  displayName
  roleArn                 // role the platform assumes in the target account
  externalId              // required, generated per-account
  status: PENDING_VERIFICATION | ACTIVE | INVALID | DISABLED
  organizationId (nullable, for AWS Organizations grouping — V1+)
  createdAt / updatedAt

Region
  code (e.g. "us-west-2")   // not a DB entity really — a controlled enum/config,
                             // but tracked per-account as "enabled regions"
  isEnabledFor(accountId)

Scan
  id (uuid)
  accountId
  regions[]                // regions included in this scan
  status: QUEUED | RUNNING | PARTIAL_SUCCESS | SUCCESS | FAILED
  startedAt / finishedAt
  triggeredBy (userId | "schedule" | "cli")
  serviceResults: { service: string, status: OK|FAILED|THROTTLED, error?, resourceCount }[]
  stats: { resourcesDiscovered, findingsGenerated, apiCallsMade, apiThrottles }

Resource
  id (uuid, internal)
  arn (unique, nullable for a few ARN-less types e.g. some VPC sub-objects)
  externalId (AWS native id, e.g. "i-0123")
  accountId, region
  service (EC2, RDS, S3, ...)
  type (instance, volume, bucket, ...)   // finer-grained than service
  name (derived from tags.Name or fallback to externalId)
  state (running, stopped, available, unattached, ...)  // normalized enum per type
  environment (derived from tags: Environment/env/stage — best-effort)
  tags (jsonb)
  metadata (jsonb — service-specific fields, see §Normalization)
  firstSeenAt, lastSeenAt, lastScanId
  isDeleted (bool — soft delete when a later scan no longer observes it)

Relationship
  id (uuid)
  sourceResourceId
  targetResourceId
  type (ATTACHED_TO | ROUTES_TO | MEMBER_OF | USES_SG | IN_SUBNET | IN_VPC | TARGETS | ASSUMES_ROLE | ...)
  discoveredInScanId
  confidence: VERIFIED | INFERRED   // e.g. "ENI says instance is in this SG" = VERIFIED;
                                    // "ALB probably targets this ECS service via TG" = still VERIFIED if TG describes it;
                                    // truly inferred cases (e.g. name-based guesses) = INFERRED, used sparingly

Metric
  id
  resourceId
  metricName (CPUUtilization, ...)
  period (e.g. daily rollup)
  statistic (avg, max, sum)
  value
  windowStart / windowEnd
  collectedAt

Finding
  id
  resourceId
  rule (POSSIBLE_IDLE_INSTANCE, UNATTACHED_EBS, ...)
  severity: low | medium | high
  status: OPEN | ACKNOWLEDGED | RESOLVED | SUPPRESSED
  evidence (jsonb)
  estimatedMonthlyCost (nullable, decimal)
  potentialMonthlySavings (nullable, decimal)
  confidence: VERIFIED | INFERRED | ESTIMATED | UNKNOWN
  discoveredInScanId
  createdAt, resolvedAt

CostSnapshot
  id
  accountId
  scope: ACCOUNT | SERVICE | RESOURCE
  resourceId (nullable — null for account/service-level rows)
  service (nullable)
  granularity: DAILY | MONTHLY
  periodStart / periodEnd
  amount
  currency
  source: COST_EXPLORER (actual) | PRICING_ESTIMATE (estimated)
```

Key modeling decision: **Resource is a single table with a `jsonb metadata` column**, not one table per AWS resource type. Rationale in §E.

---

## E. Database Schema

```sql
-- Accounts the platform can scan
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aws_account_id CHAR(12) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role_arn TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  enabled_regions TEXT[] NOT NULL DEFAULT '{}',
  organization_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per scan execution
CREATE TABLE scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  regions TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',   -- QUEUED|RUNNING|PARTIAL_SUCCESS|SUCCESS|FAILED
  triggered_by TEXT NOT NULL,
  service_results JSONB NOT NULL DEFAULT '[]',
  stats JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scans_account_created ON scans(account_id, created_at DESC);

-- The core resource inventory table (ALL resource types, one table)
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  region TEXT NOT NULL,               -- 'global' for CloudFront/Route53/IAM
  arn TEXT NULL,
  external_id TEXT NOT NULL,          -- native AWS id
  service TEXT NOT NULL,              -- 'EC2', 'RDS', ...
  type TEXT NOT NULL,                 -- 'instance', 'volume', 'bucket', ...
  name TEXT,
  state TEXT,
  environment TEXT,                   -- best-effort from tags
  tags JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scan_id UUID REFERENCES scans(id),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (account_id, region, service, external_id)
);
CREATE INDEX idx_resources_account ON resources(account_id) WHERE NOT is_deleted;
CREATE INDEX idx_resources_service ON resources(service);
CREATE INDEX idx_resources_region ON resources(region);
CREATE INDEX idx_resources_environment ON resources(environment);
CREATE INDEX idx_resources_name_trgm ON resources USING gin (name gin_trgm_ops);   -- search
CREATE INDEX idx_resources_tags_gin ON resources USING gin (tags jsonb_path_ops);
CREATE INDEX idx_resources_arn ON resources(arn);

-- Edges between resources
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  target_resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                 -- 'ATTACHED_TO','IN_SUBNET','USES_SG','TARGETS',...
  confidence TEXT NOT NULL DEFAULT 'VERIFIED',
  discovered_in_scan_id UUID REFERENCES scans(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_resource_id, target_resource_id, type)
);
CREATE INDEX idx_rel_source ON relationships(source_resource_id);
CREATE INDEX idx_rel_target ON relationships(target_resource_id);

-- Time-series utilization data, pre-aggregated (NOT raw CloudWatch datapoints)
CREATE TABLE metrics (
  id BIGSERIAL PRIMARY KEY,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,          -- 'CPUUtilization', ...
  statistic TEXT NOT NULL,            -- 'avg','max','sum'
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (window_start);
-- monthly partitions, e.g. metrics_2026_09; created by a scheduled maintenance task
CREATE INDEX idx_metrics_resource ON metrics(resource_id, metric_name, window_start DESC);

-- Findings from the rule engine
CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,                 -- 'POSSIBLE_IDLE_INSTANCE', ...
  severity TEXT NOT NULL,             -- 'low'|'medium'|'high'
  status TEXT NOT NULL DEFAULT 'OPEN',
  evidence JSONB NOT NULL,
  estimated_monthly_cost NUMERIC(12,2),
  potential_monthly_savings NUMERIC(12,2),
  confidence TEXT NOT NULL,           -- VERIFIED|INFERRED|ESTIMATED|UNKNOWN
  discovered_in_scan_id UUID REFERENCES scans(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (resource_id, rule) -- one open finding per rule per resource; re-evaluated each scan
);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_resource ON findings(resource_id);
CREATE INDEX idx_findings_rule ON findings(rule);

-- Cost data, both actual (Cost Explorer) and estimated (pricing model)
CREATE TABLE cost_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  resource_id UUID REFERENCES resources(id),   -- null for account/service scope
  service TEXT,                                -- null for resource scope
  scope TEXT NOT NULL,                         -- ACCOUNT|SERVICE|RESOURCE
  granularity TEXT NOT NULL,                   -- DAILY|MONTHLY
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL,                        -- COST_EXPLORER|PRICING_ESTIMATE
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cost_account_period ON cost_snapshots(account_id, period_start DESC);
CREATE INDEX idx_cost_resource ON cost_snapshots(resource_id);

-- pg-boss creates its own schema (job, archive, subscription) automatically — no custom table needed.
```

Notes:
- **Why one `resources` table, not per-service tables**: You have ~15–30 resource types today and the list will grow. A table-per-type either forces a giant polymorphic join layer for the graph/table views (which need to mix all types uniformly) or forces the frontend to know every type's schema. A single table with common columns + `jsonb metadata` gives you one query path for the Resource Explorer and Graph, while `metadata` (indexed with GIN where needed) still supports service-specific filtering (e.g. `metadata->>'instanceType' = 't3.large'`). Add typed columns later only for fields you filter/sort on constantly (already done: `state`, `environment`).
- **Relationships stored explicitly, not computed at query time** — see §G for the reasoning.
- **Metrics table is pre-aggregated rollups** (e.g. one row per resource/metric/day), never raw 1-minute CloudWatch datapoints — keeps table growth linear in resource count × days, not resource count × days × 1440.
- Partitioning `metrics` by month is the one piece of schema complexity that's justified up front, because this table's growth rate dominates all others (see §Y).

---

## F. AWS Scanner Architecture

```typescript
// packages/aws-scanner/src/types.ts
interface ScanContext {
  account: AwsAccount;          // includes assumed credentials provider
  region: string;
  logger: ScopedLogger;
  apiCallRecorder: ApiCallRecorder;   // counts calls, records throttles
}

interface ResourceScanner {
  readonly service: string;         // 'EC2', 'RDS', ...
  readonly scope: 'REGIONAL' | 'GLOBAL';
  scan(ctx: ScanContext): Promise<RawDiscoveryResult>;
}

interface RawDiscoveryResult {
  resources: NormalizedResource[];
  errors: ScannerError[];          // partial-failure friendly: a scanner can return
                                    // some resources AND some errors in the same call
}
```

Organization:

```text
packages/aws-scanner/
├── src/
│   ├── scanners/
│   │   ├── ec2.scanner.ts
│   │   ├── ebs.scanner.ts
│   │   ├── vpc.scanner.ts          // vpc, subnet, route table, IGW, NAT GW, SG
│   │   ├── rds.scanner.ts
│   │   ├── ecs.scanner.ts
│   │   ├── alb.scanner.ts          // ALB/NLB + target groups
│   │   ├── s3.scanner.ts           // global
│   │   ├── lambda.scanner.ts
│   │   ├── sqs.scanner.ts
│   │   └── cloudfront.scanner.ts   // global
│   ├── registry.ts                 // ordered list of scanners + region-scope metadata
│   ├── credentials.ts              // sts:AssumeRole → cached, auto-refreshing provider
│   ├── pagination.ts               // generic paginator wrapper
│   ├── retry.ts                    // exponential backoff + jitter, per-service concurrency limit
│   └── normalize/
│       ├── ec2.normalize.ts
│       ├── rds.normalize.ts
│       └── ...
```

Each scanner:
1. Uses the AWS SDK v3 built-in **paginators** (`paginateDescribeInstances`, etc.) wrapped in a shared retry/backoff helper (see §17/Q).
2. Returns **normalized** resources directly — normalization logic lives next to the scanner that produces the raw shape, not as a separate late pass, because only the EC2 scanner really knows how to map an EC2 `Instance` to the common schema.
3. Never throws on a single API failure for its own service; it collects errors and returns what it could get, so `ScanOrchestrator` can mark that service `THROTTLED`/`FAILED` while keeping everything else.

```typescript
// scan-orchestrator.ts (worker package)
class ScanOrchestrator {
  async run(scan: Scan): Promise<void> {
    const globalScanners = registry.filter(s => s.scope === 'GLOBAL');
    const regionalScanners = registry.filter(s => s.scope === 'REGIONAL');

    // global scanners run once, not once per region (see §18)
    await this.runScanners(globalScanners, { region: 'global' });

    for (const region of scan.regions) {
      await this.runScanners(regionalScanners, { region });
    }

    await relationshipEngine.build(scan.id);
    await metricsEngine.collect(scan.id);
    await ruleEngine.evaluate(scan.id);
    await costEngine.reconcile(scan.id);

    await this.finalizeStatus(scan.id); // SUCCESS | PARTIAL_SUCCESS | FAILED
  }
}
```

Concurrency: scanners within a region run **concurrently with a per-service semaphore** (e.g. max 5 in-flight describe calls per service), not globally serialized — total wall-clock for a scan across 10 services × 2 regions should be a couple minutes, not tens of minutes.

---

## G. Relationship Engine

> **Implementation note (INFRA-010, refined during design review):** The engine derives edges over the **full live account resource set** (`WHERE account_id = $acct AND is_deleted = false`), NOT `WHERE last_scan_id = scanId`. This is a deliberate deviation from the "once per scan over the new set" wording below, required for correctness: soft-delete is scoped per `(service, region)` and only for services whose scan status was `OK`, so a region-limited or partial-failure scan intentionally keeps other rows live. If the engine derived only over the current scan's rows but pruned account-wide, it would delete still-valid edges (e.g. a us-west-2 scan wiping eu-west-1 edges; a VPC-throttled scan wiping live instance→subnet edges). Deriving over the full live set re-affirms every valid edge to the current scanId before an account-wide prune removes only genuinely-gone edges. A prune-skip guard (empty live set ⇒ no prune) prevents a total-failure build from wiping the graph. External-AWS-id→internal-uuid resolution is keyed by `(accountId, region, externalId)` with a target `service/type` allow-list guard to defend against namespace collisions.

**Decision: relationships are computed once per scan and stored explicitly in `relationships`, not computed dynamically at read time.**

Why:
- The graph view and resource-detail "relationships" panel are read paths that need to be fast and simple (`SELECT * FROM relationships WHERE source_resource_id = $1 OR target_resource_id = $1`) — no runtime AWS-shape knowledge needed.
- Computing relationships dynamically would mean re-deriving "this ENI's SG list maps to these SG resource rows" on every page load, duplicating logic the scanner already has, and coupling read latency to how much metadata got stored.
- Storing explicitly also gives you relationship **history** for free (`discovered_in_scan_id`).
  - **Implementation note (INFRA-010):** the MVP engine keeps the graph aligned to *current* live state — an edge whose endpoint is soft-deleted (resource gone) is **pruned**, not retained, so the graph never shows dangling edges to invisible nodes. (Hard-deleted resources cascade their edges via the FK.) Retaining edges to deleted resources for a "what *used to* be attached to this now-deleted instance" history view is a deliberate **future** feature (it requires the graph/read layer to render soft-deleted endpoints), not MVP. The earlier wording that edges "survive even if one side is deleted" describes that future capability, not current behavior.

How relationships are discovered (deterministic, not guessed, except where explicitly marked `INFERRED`):

| Relationship | Source of truth |
|---|---|
| EC2 → Subnet, EC2 → SG, EC2 → EBS Volume, EC2 → IAM Instance Profile | `DescribeInstances` response fields directly (NetworkInterfaces, SecurityGroups, BlockDeviceMappings, IamInstanceProfile) |
| ALB/NLB → VPC, → Subnet, → SG | `DescribeLoadBalancers` |
| ALB → Target Group → (EC2 / ECS task / IP) | `DescribeTargetGroups` + `DescribeTargetHealth` |
| ECS Service → Cluster, → Task Definition, → Target Group, → SG, → Subnet | `DescribeServices` (network config + load balancers block) |
| RDS → Subnet Group → Subnets, → VPC, → SG, → Parameter Group | `DescribeDBInstances` |
| Lambda → VPC config (SG/Subnet) if VPC-attached, → IAM role | `GetFunctionConfiguration` |
| CloudFront → Origin (ALB/S3) | `GetDistributionConfig` origins list (string match on domain name → resource lookup; marked `VERIFIED` since it's a direct config reference, not a guess) |
| NAT Gateway → Subnet, → EIP | `DescribeNatGateways` |
| Everything → VPC (transitively via subnet) | derived: if A is IN_SUBNET subnet X, and subnet X IN_VPC vpc Y, relationship engine also writes A→vpc Y directly for fast "group by VPC" queries (denormalized edge, marked with a `via` note in a future `evidence` column if needed) |

`INFERRED` is reserved for genuinely fuzzy cases the MVP should mostly avoid (e.g., guessing an app's dependency from naming conventions alone) — not needed for the MVP rule set above, since everything above comes from an explicit AWS API field.

Relationship building runs **after all scanners for a scan complete**, as one pass over the newly-discovered resource set (`WHERE last_scan_id = scan.id`), so cross-service edges (ALB→ECS, ECS→RDS via SG) can be resolved regardless of scanner execution order.

---

## H. Metrics Engine

CloudWatch is called **only for resources that need utilization-based findings** — not for every discovered resource (e.g., S3 buckets and SQS queues don't need CPU metrics for MVP rules).

| Service | Metrics (MVP) | Period | Stat | Lookback |
|---|---|---|---|---|
| EC2 | CPUUtilization, NetworkIn, NetworkOut | 1 hour, rolled up to daily avg | Average | 30 days |
| RDS | CPUUtilization, DatabaseConnections, FreeableMemory | 1 hour → daily avg | Average | 30 days |
| ALB | RequestCount, TargetResponseTime | 1 hour → daily sum/avg | Sum (RequestCount), Average (latency) | 30 days |
| NAT Gateway | BytesOutToDestination, BytesInFromDestination | 1 hour → daily sum | Sum | 30 days |

Implementation:
- Use `GetMetricData` (not `GetMetricStatistics`) — it supports batching up to 500 metric queries per call, which matters a lot once you have hundreds of EC2 instances; this is the single biggest lever on CloudWatch API cost and call volume.
- Batch by account+region: one `GetMetricData` call can request CPUUtilization for 100+ instances at once via multiple `MetricDataQuery` entries.
- Store only **daily rollups** in `metrics` (see schema) — never persist raw 1-minute/5-minute datapoints. The rule engine only needs a 30-day average/max.
- **Caching / refresh cadence**: metrics are refreshed once per scan, not continuously polled. ASSUMPTION: scans run on a schedule (e.g. daily) or on-demand — there's no standing "live monitoring" requirement stated, so no need for a separate polling loop between scans.
- **API cost**: `GetMetricData` is billed per metric per call beyond the free tier; batching keeps this to roughly `(instances / batch_size)` calls per account per scan, not one call per instance per metric. Rough order of magnitude: 500 EC2 instances × 2 metrics batched at 500/call ≈ 2 API calls for the whole fleet's CPU+Network for one scan.
- Retention: keep 90 days of daily rollups (`metrics` partitions dropped after 90 days by a scheduled cleanup job) — enough for 30-day rule windows plus trend history, without unbounded growth.

---

## I. Waste Detection Engine

```text
Resource + Metrics
        │
        ▼
   Rule Engine  (pure functions: (resource, metrics, relatedResources) => Finding | null)
        │
        ├── Cost rules          (e.g. unattached EBS still billed)
        ├── Utilization rules   (e.g. idle EC2, oversized RDS)
        ├── Configuration rules (e.g. unused EIP — pure config, no metrics needed)
        └── Architecture rules  (e.g. ALB with zero healthy targets)
        │
        ▼
     Finding (persisted, re-evaluated & upserted every scan by (resource_id, rule))
```

MVP rules:

```text
POSSIBLE_IDLE_INSTANCE (EC2)
  IF state == running
  AND avg(CPUUtilization, 30d) < 5%
  AND observation period >= 14 days (of data actually available — see confidence note)
  THEN severity=medium, confidence=INFERRED (usage-based, not a guaranteed truth)

UNATTACHED_EBS (EBS)
  IF volume.state == 'available'
  THEN severity=medium, confidence=VERIFIED (this is a direct AWS-reported fact)

UNUSED_ELASTIC_IP (EIP)
  IF association == null
  THEN severity=low, confidence=VERIFIED

LOW_USAGE_NAT_GATEWAY (NAT Gateway)
  IF sum(BytesOutToDestination + BytesInFromDestination, 30d) < threshold (e.g. 1GB total)
  THEN severity=low, confidence=INFERRED

POSSIBLE_OVERSIZED_RDS (RDS)
  IF avg(CPUUtilization, 30d) < 10%
  AND avg(DatabaseConnections, 30d) < small threshold (e.g. 5)
  THEN severity=medium, confidence=INFERRED

LOW_USAGE_LOAD_BALANCER (ALB)
  IF sum(RequestCount, 30d) below threshold (e.g. < 100 requests/day avg)
  THEN severity=low, confidence=INFERRED

STOPPED_INSTANCE_STILL_BILLED_EBS (EC2 + EBS, cross-resource rule)
  IF instance.state == 'stopped' AND age > 30 days AND has attached EBS volumes
  THEN flag the EBS volumes' ongoing cost, severity=low, confidence=VERIFIED
```

Confidence taxonomy (applies to every finding):

| Confidence | Meaning |
|---|---|
| `VERIFIED` | Directly reported by AWS as a fact (e.g., volume state = available) |
| `INFERRED` | Derived from utilization data / heuristics — plausible but not certain (e.g., low CPU ≠ definitely unused) |
| `ESTIMATED` | Involves a cost/savings number computed from a pricing model, not AWS-billed truth |
| `UNKNOWN` | Rule couldn't fully evaluate (e.g., insufficient metric history) — surfaced, not silently dropped |

Findings are **upserted** per `(resource_id, rule)` on every scan: if a finding no longer triggers, mark it `RESOLVED` (don't delete — keeps history of "this was flagged, then fixed").

---

## J. Cost Engine

Three distinct numbers, never conflated:

```text
Actual AWS cost         → AWS Cost Explorer GetCostAndUsage, grouped by SERVICE (and by
                           resource tag/ resource ID where Cost Explorer's resource-level
                           granularity is enabled — note: this requires the account to have
                           "Cost Allocation Tags" and resource-level CE data activated, which
                           not all accounts have — treat as best-effort, fall back gracefully)

Estimated resource cost → computed from a static pricing table (cached from the AWS Price
                           List API, refreshed periodically, keyed by service+instance
                           type+region) × observed usage (e.g. hours running this month for
                           EC2/RDS, GB-months for EBS/S3). This is what powers the per-resource
                           "Estimated monthly cost: ~$61" shown in the resource detail view.

Potential savings        → derived only from findings (e.g. UNATTACHED_EBS → its estimated
                           monthly cost IS the potential saving; POSSIBLE_IDLE_INSTANCE →
                           potential saving = estimated cost, but confidence=ESTIMATED and
                           explicitly labeled "if terminated/rightsized", never guaranteed)
```

Implementation:
- **CostSnapshot rows with `source = COST_EXPLORER`** hold actual account/service-level spend — fetched once per scan (or on a separate daily schedule, since Cost Explorer data lags ~24h anyway and doesn't need per-scan freshness).
- **CostSnapshot rows with `source = PRICING_ESTIMATE`** hold per-resource estimates — computed by the cost engine using a small internal pricing rules module (`packages/cost`), not a live Pricing API call per resource (Pricing API is slow/awkward for bulk use; cache a pricing table per region, refreshed weekly via a scheduled job).
- The UI must **always label which number is which** — "Actual cost: $X (from Cost Explorer)" vs "Estimated cost: ~$Y (pricing model)" — never merge them into a single unlabeled "$ / month".
- MVP pricing coverage: On-Demand pricing only for EC2, RDS, and EBS (the three services with the most impactful and easiest-to-model waste findings). S3/Lambda/SQS cost estimation deferred to V1 (usage-based pricing for these is noisier — request counts, storage class mix, etc.).

---

## K. API Design

Base path `/api/v1`. All authenticated via platform session (see §N). Below: representative endpoints, not the full CRUD surface.

```text
POST /accounts
  Request:
  {
    "displayName": "Production",
    "awsAccountId": "123456789012",
    "roleArn": "arn:aws:iam::123456789012:role/InfraExplorerReadOnly",
    "enabledRegions": ["us-west-2", "us-east-1"]
  }
  Response: 201
  {
    "id": "acc_...",
    "status": "PENDING_VERIFICATION",
    "externalId": "ie-7f3a9c21"   // generated, must be added to the target role's trust policy
  }

POST /accounts/:id/verify
  Attempts sts:AssumeRole once; returns ACTIVE or INVALID with the exact STS error.

POST /scans
  Request: { "accountId": "acc_...", "regions": ["us-west-2"] }
  Response: 202 { "scanId": "scan_...", "status": "QUEUED" }
  (returns immediately — see §M)

GET /scans/:id
  Response:
  {
    "id": "scan_...", "status": "PARTIAL_SUCCESS",
    "serviceResults": [
      { "service": "EC2", "status": "OK", "resourceCount": 42 },
      { "service": "CloudFront", "status": "THROTTLED", "error": "Rate exceeded", "resourceCount": 0 }
    ],
    "stats": { "resourcesDiscovered": 238, "findingsGenerated": 31, "durationMs": 94210 }
  }

GET /resources?service=EC2&region=us-west-2&environment=prod&state=running&search=api&page=1
  Response:
  {
    "items": [
      { "id": "res_...", "service": "EC2", "type": "instance", "name": "api-prod",
        "state": "running", "region": "us-west-2", "estimatedMonthlyCost": 61.0,
        "findingsCount": 1 }
    ],
    "total": 238, "page": 1, "pageSize": 50
  }

GET /resources/:id
  Response: full normalized resource + latest metrics summary + open findings + cost snapshot

GET /resources/:id/relationships
  Response: { "outgoing": [{ "type": "IN_SUBNET", "target": {...} }], "incoming": [...] }

GET /graph?accountId=acc_...&region=us-west-2&environment=prod
  Response: { "nodes": [{ "id", "service", "type", "name", "hasFindings" }],
              "edges": [{ "source", "target", "type" }] }
  (server pre-filters and caps node count — see §L performance note)

GET /findings?severity=medium&status=OPEN&service=EC2
  Response: { "items": [ { "id", "rule", "resourceId", "severity", "confidence",
                            "estimatedMonthlyCost", "potentialMonthlySavings" } ], "total": 31 }

GET /cost?accountId=acc_...&scope=SERVICE&period=2026-09
  Response: { "actual": [{ "service": "EC2", "amount": 4210.55, "source": "COST_EXPLORER" }],
              "estimatedTotal": 12482.00, "potentialSavings": 1284.00 }
```

---

## L. Frontend Design

Three pages, matching the product spec exactly — resist adding a fourth.

```text
apps/web/src/
├── app/
│   ├── overview/page.tsx
│   ├── graph/page.tsx
│   └── resources/page.tsx
├── components/
│   ├── overview/
│   │   ├── AccountSummaryCards.tsx
│   │   ├── ResourceCountByService.tsx
│   │   ├── CostSummaryCard.tsx        // actual vs estimated vs waste, clearly separated
│   │   └── FindingsSummaryList.tsx
│   ├── graph/
│   │   ├── InfraGraph.tsx             // React Flow canvas + dagre/elkjs layout
│   │   ├── GraphFilters.tsx           // account/region/service/environment
│   │   ├── GraphSearch.tsx
│   │   └── ResourceNode.tsx           // custom node renderer (icon + name + finding badge)
│   ├── resources/
│   │   ├── ResourceTable.tsx          // virtualized (react-virtual) for large lists
│   │   └── ResourceFilters.tsx
│   ├── shared/
│   │   ├── ResourceDetailDrawer.tsx   // used from BOTH graph and table
│   │   ├── FindingBadge.tsx
│   │   └── CostLabel.tsx              // renders "Actual" vs "Estimated" consistently
│   └── layout/
│       ├── AppShell.tsx
│       └── AccountRegionSwitcher.tsx
├── lib/
│   ├── api-client.ts                  // typed fetch wrapper, shares types with packages/domain
│   └── hooks/ (useResources, useGraph, useFindings — react-query)
```

- **State/data fetching**: React Query (TanStack Query) for all API calls — polling `GET /scans/:id` while a scan is `RUNNING`/`QUEUED` is a natural fit for its refetch-interval support.
- **Graph performance**: server-side caps and pre-filtering are mandatory. Don't ship 5,000 nodes to React Flow. `GET /graph` requires at least one filter (account is mandatory; region/environment optional) and the API enforces a hard node cap (e.g. 500) with a "narrow your filters" response if exceeded, rather than silently truncating.
- **Resource detail drawer** is a single shared component invoked from both the Graph (click node) and Resource Explorer (click row) — same data, same component, two entry points. This directly matches the example in the spec (EC2 detail view with cost + finding).
- Dark/light mode: ASSUMPTION — nice-to-have, not MVP-blocking; use Tailwind's `dark:` classes from day one (near-zero cost to keep the option open) but don't build a theme switcher until V1.

---

## M. Async Scan System

```text
POST /scans
   │
   ▼
API: validate account+regions, INSERT scans row (status=QUEUED),
     pg-boss.send('run-scan', { scanId }) — same DB transaction
   │
   ▼
202 Accepted { scanId }              ◀── HTTP request ends here, in milliseconds
   │
   ▼ (async, separate process)
Worker (ECS Fargate, long-running, polls pg-boss queue)
   │
   ├─ picks up 'run-scan' job
   ├─ UPDATE scans SET status='RUNNING', started_at=now()
   ├─ ScanOrchestrator.run(scan)   — see §F
   │     (per-service try/catch; a THROTTLED/FAILED service doesn't abort the scan)
   ├─ relationshipEngine → metricsEngine → ruleEngine → costEngine
   └─ UPDATE scans SET status = (all services OK ? 'SUCCESS' : any succeeded ? 'PARTIAL_SUCCESS' : 'FAILED')
   │
   ▼
Frontend polls GET /scans/:id every 2–3s while QUEUED/RUNNING, stops on terminal status
```

Why pg-boss over SQS/BullMQ/Step Functions for MVP:

| Option | Verdict for MVP |
|---|---|
| **pg-boss (chosen)** | Zero new infrastructure (uses the Postgres you already run); transactional enqueue with the scan row; sufficient throughput for "a handful of scans running concurrently," which is the actual MVP load. |
| SQS + Lambda | Lambda's 15-minute timeout is a real risk for large-account scans; needs a separate orchestration layer (Step Functions) to fan out per-service work reliably — more moving parts than the problem currently justifies. |
| BullMQ + Redis | Functionally similar to pg-boss but adds a whole new stateful dependency (Redis) for no capability MVP needs. |
| Step Functions | Genuinely a good fit **later** if scans need per-service-step visibility/retries at the orchestration layer or must fan out across many accounts in parallel at scale — revisit at V2 multi-account scale (see §Y). |

The worker is a **single long-running ECS Fargate service** (not per-scan Fargate tasks) for MVP — simplest operational model; move to per-scan ephemeral tasks only if scan concurrency/isolation becomes a real problem.

---

## N. Security Model

**Cross-account access:**
- The platform (control account) provides customers/users an **ExternalId** (randomly generated per `Account` row, `ie-<random>`) and a documented trust policy snippet:
```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::<CONTROL_ACCOUNT_ID>:role/InfraExplorerWorkerRole" },
  "Action": "sts:AssumeRole",
  "Condition": { "StringEquals": { "sts:ExternalId": "ie-7f3a9c21" } }
}
```
  Enforcing ExternalId is **mandatory**, not optional — it's the standard mitigation for the "confused deputy" problem where account A could otherwise trick the platform into assuming account B's role.
- The target-side role (`InfraExplorerReadOnly`) is attached **only** AWS-managed or hand-authored read-only policies (`ReadOnlyAccess` is broader than needed — prefer a hand-scoped policy limited to `Describe*`, `List*`, `Get*` on the specific services in scope, plus `cloudwatch:GetMetricData`, `ce:GetCostAndUsage`). Document this policy in `infra/target-account/` as a Terraform module the customer/account-owner applies.
- **No long-lived keys ever, in either direction.** The worker's own AWS identity is its ECS task role (assumed automatically); it uses `sts:AssumeRole` (with `fromTemporaryCredentials` in SDK v3) to obtain short-lived (1-hour, default) creds for the target account, cached in-memory only for the duration of a scan, never persisted.
- **User-controlled ARN input is a real risk** the spec calls out — validate `roleArn` server-side against a strict pattern (`^arn:aws:iam::\d{12}:role/[\w+=,.@-]+$`) and reject anything else before ever calling `AssumeRole` with it, to avoid the API being used as an arbitrary-ARN probe (SSRF-adjacent risk in this context). Rate-limit `POST /accounts/:id/verify` per account/user to prevent using it to enumerate role existence in unrelated accounts.
- STS session duration: request the minimum needed (default 1h) via `AssumeRole`'s `DurationSeconds`; never request/cached-refresh beyond a single scan's lifetime.

**Platform-level security:**
- **AuthN**: session-based login (see §C — start simple, OIDC-ready later). All API routes behind auth middleware except `/health`.
- **AuthZ / tenant isolation**: ASSUMPTION — MVP is single-tenant (one internal team), so authorization is just "logged in or not." If multiple teams/orgs will use one deployment, add an `organization_id` scoping layer on `accounts`/`resources` queries before that becomes a real requirement (flag as V1 if needed — don't build multi-tenant RBAC speculatively).
- **Secrets storage**: DB credentials and any platform secrets in AWS Secrets Manager, injected into ECS tasks via task definition secrets (not env vars baked into images).
- **Encryption**: RDS encryption-at-rest enabled, TLS everywhere (ALB listeners HTTPS-only, RDS `sslmode=require`), S3 bucket for frontend static assets private + served only via CloudFront OAC.
- **Audit log**: a simple `audit_log` table (actor, action, target, timestamp) recording account creation/deletion and scan triggers at minimum — who added which role ARN, and when scans ran against which account.
- **Rate limiting**: per-user/IP rate limit on `POST /scans` and `POST /accounts/:id/verify` (the two endpoints that trigger outbound AWS calls) to prevent accidental or malicious hammering of a target account's API limits.
- **Sensitive data redaction**: never log full STS credentials; redact `SecretAccessKey`/`SessionToken` from any structured log output at the logger-transport level, not ad hoc per call site.

---

## O. Multi-account / Multi-region

- **MVP**: single account, multi-region within that account. The `accounts` table and `sts:AssumeRole` design already assume multi-account from day one (it's not a bolt-on) — MVP just doesn't build the UI/bulk-scan-scheduling for managing many accounts at once.
- **V1**: multiple independently-added accounts (manual entry, one at a time, each with its own role ARN + externalId) — the schema already supports this (`resources.account_id`, `scans.account_id`).
- **V2 (AWS Organizations)**: instead of manually adding each account, the platform assumes a role in the **Organizations management account** to call `ListAccounts`, then offers "bulk-enable scanning" for member accounts (still requires each member account to have deployed the `InfraExplorerReadOnly` role + trust policy — Organizations doesn't grant that automatically; pair with a StackSet/Terraform module the org deploys once).
- **Regional vs global handling**: the scanner registry tags each `ResourceScanner` with `scope: REGIONAL | GLOBAL` (§F). Global scanners (CloudFront, Route53, IAM-adjacent lookups) run **exactly once per scan**, not once per region, and their resources are stored with `region = 'global'`. This avoids both duplicate rows and wasted API calls (a real risk the spec explicitly flags in §18).
- S3 is a special case: buckets are global resources, but bucket **location** (region) matters for display/grouping — the S3 scanner calls `GetBucketLocation` per bucket once, tags the resource with its real region, but the *scan* of "list all buckets" itself is a global, once-per-scan operation.

---

## P. CLI

```text
cli/
└── src/
    ├── commands/
    │   ├── accounts.ts   (list, add, verify)
    │   ├── scan.ts
    │   ├── resources.ts  (list, get)
    │   ├── findings.ts   (list)
    │   └── graph.ts      (export)
    └── client.ts         // thin HTTP client against the same REST API — NOT a reimplementation
```

**Critical design constraint (per spec §19): the CLI is an API client, not a second scanner implementation.** It authenticates against the same backend (e.g. an API token flow — `infra-explorer login` stores a token in `~/.config/infra-explorer/credentials`) and calls the same REST endpoints from §K. This guarantees CLI and web always see identical data and logic, and means the CLI needs zero AWS credentials of its own for `resources`/`findings`/`graph` commands.

The one exception worth flagging: `infra-explorer scan --profile my-prod --regions ...` as shown in the spec implies a **local** AWS profile — decide explicitly whether the CLI (a) tells the *server* to run a scan against an already-registered account (recommended — consistent with "CLI uses the same backend"), or (b) runs a scan locally using local AWS credentials without ever registering the account server-side. **Recommendation: (a) only for MVP** — `--profile` in the CLI is used solely to resolve *which already-registered account* to target (e.g., by matching account ID), not to inject local credentials into a scan. Running fully local, disconnected scans is a reasonable V1+ "CLI standalone mode" feature but would require duplicating scanner invocation logic client-side, contradicting the "don't duplicate" principle — defer it.

```bash
infra-explorer accounts list
infra-explorer accounts add --name Production --aws-account-id 123456789012 --role-arn arn:...
infra-explorer scan --account production --regions us-west-2,ap-southeast-1
infra-explorer scan status <scan-id>
infra-explorer resources list --service EC2 --region us-west-2 --state running
infra-explorer resources get i-0123456789
infra-explorer findings list --severity high
infra-explorer graph export --account production --format json > graph.json
```

---

## Q. Deployment Architecture

```text
                     CloudFront (frontend, OAC → private S3)
                              │
                     Route53 (app.infra-explorer.internal)
                              │
                     ALB (internal or internet-facing behind SSO/VPN — ASSUMPTION: internal tool,
                          recommend placing behind existing corporate VPN/SSO proxy, not public internet)
                              │
                     ECS Fargate Service: API  (NestJS, min 1 / max N tasks, target-tracking on CPU)
                              │
                     ECS Fargate Service: Worker (1-2 tasks; scan concurrency bound by task count)
                              │
                     RDS PostgreSQL (Multi-AZ optional for MVP — single-AZ acceptable given internal
                                      tool + async recoverable workload; enable Multi-AZ before any
                                      SLA commitment)
```

- **CI/CD**: GitHub Actions (ASSUMPTION: GitHub is the VCS) — build & push Docker images to ECR, `terraform plan/apply` for infra changes (manual approval gate on `apply`), ECS rolling deploy via `aws ecs update-service --force-new-deployment` or CodeDeploy blue/green if zero-downtime matters (probably not critical for an internal read-only tool — rolling deploy is enough for MVP).
- **Environments**: `dev` and `prod` as two separate Terraform workspaces/state files, sharing modules.
- Why not Kubernetes: no concrete requirement for multi-cloud, custom schedulers, or existing K8s investment — ECS Fargate gives equivalent container orchestration with far less operational surface for a 2-service (api+worker) application. Revisit only if the org already standardizes on EKS elsewhere.

---

## R. Observability

- **Structured logs** (JSON, one line per event) from API and worker → CloudWatch Logs. Every scan-related log line carries `scanId`, `accountId`, `region`, `service` for correlation.
- **Key metrics emitted (as CloudWatch custom metrics or structured "metric" log lines aggregated via CloudWatch Logs Insights/metric filters)**:
```text
scan_duration_ms{account,status}
resources_discovered_total{account,service}
aws_api_calls_total{account,service}
aws_api_throttles_total{account,service}
scan_failures_total{account,service,error_type}
findings_generated_total{account,rule}
api_request_duration_ms{route,status}
worker_queue_depth
```
- **Scan success rate**: derived from `scans.status` over time — expose as a simple internal query/dashboard (`% SUCCESS+PARTIAL_SUCCESS over last 30 scans per account`), not a bespoke pipeline.
- **DB performance**: RDS Performance Insights enabled (cheap, built-in) rather than standing up a separate monitoring stack.
- No new observability vendor for MVP — CloudWatch dashboards are sufficient at this scale; revisit only if the team already runs Grafana/Datadog elsewhere and wants everything in one pane.

---

## S. Testing Strategy

- **Unit tests** (Jest, run in CI on every PR, no AWS access needed):
  - Normalization: given a captured raw AWS SDK response fixture (e.g. a real anonymized `DescribeInstances` payload), assert the normalized `Resource` shape.
  - Relationship engine: given a fixed set of normalized resources, assert expected edges.
  - Rule engine: given resource + synthetic metrics fixtures, assert Finding output (including the "no finding" case — equally important to test).
  - Cost engine: given a pricing table fixture + usage input, assert estimated cost math.
- **Integration tests**:
  - AWS SDK calls mocked via `aws-sdk-client-mock` (v3-native) — test the *scanner* against realistic paginated/error responses (including a simulated `ThrottlingException` to verify retry/backoff behavior).
  - Real PostgreSQL (via Testcontainers or a Dockerized Postgres in CI) for repository-layer tests — schema, indexes, upsert-on-rescan behavior for `resources`/`findings`.
  - Full scan pipeline test: mocked AWS responses → orchestrator → assert DB state (resources + relationships + findings) end to end, still without a real AWS account.
- **E2E** (Playwright, against a fully mocked-AWS backend in a CI environment): create account (with a mocked/fake role that "verifies" successfully) → trigger scan → poll status → assert graph renders nodes → assert findings panel shows expected counts → assert resource detail drawer shows cost. Run in CI, no real AWS credentials required.
- A small, optional **manual/scheduled smoke test against a real disposable AWS sandbox account** (not part of CI) is worth having once V1 ships, to catch drift in AWS API response shapes over time — explicitly out of scope for MVP CI.

---

## T. MVP Definition (strict)

**Services scanned (10, matching the spec's suggested set almost exactly, with VPC's sub-resources itemized since they matter for the graph):**

```text
EC2 (instances)
EBS (volumes)
VPC (+ subnets, security groups, route tables, internet gateway, NAT gateway)
RDS (instances only — Aurora clusters deferred to V1, similar-enough shape but adds edge cases)
ECS (clusters, services, task definitions — Fargate launch type only for MVP)
ALB (+ target groups; NLB deferred — same scanner shape, small V1 add)
S3 (buckets, bucket-level only — no per-object anything)
Lambda (functions)
SQS (queues)
CloudFront (distributions)
```

Deliberately **excluded from MVP** (all listed in the spec's full service list, deferred to V1/V2 — see next section for why): EKS, DynamoDB, ElastiCache, OpenSearch, Transit Gateway, EFS, snapshots, SNS, EventBridge, Route53, ECR, Auto Scaling Groups (ASG *detection* is easy but ASG-aware findings — e.g. "don't flag an idle instance that's part of an ASG scaling policy" — add real rule-engine complexity better tackled once core rules are proven).

**MVP feature scope:**
- Single AWS account, multi-region (region list configured per account).
- Scan triggered manually (`POST /scans` from UI button or CLI) — no scheduling/cron yet.
- Normalization + relationships for the 10 services above.
- CloudWatch metrics: EC2 CPU/Network, RDS CPU/Connections only (ALB/NAT metrics can wait for their respective waste rules in V1 if time-constrained — but recommend including since ALB/NAT rules are cheap once the metrics engine exists).
- Rule engine: `POSSIBLE_IDLE_INSTANCE`, `UNATTACHED_EBS`, `UNUSED_ELASTIC_IP` as the three must-have rules (highest signal-to-effort ratio); `POSSIBLE_OVERSIZED_RDS`, `LOW_USAGE_LOAD_BALANCER`, `LOW_USAGE_NAT_GATEWAY` as stretch-within-MVP.
- Cost engine: estimated cost for EC2/RDS/EBS only (On-Demand pricing table); actual account-level cost from Cost Explorer for the Overview page.
- All three frontend pages (Overview, Graph, Resource Explorer) with the filters specified.
- Basic auth (single/few internal users), read-only IAM role assumption, audit log for account/scan actions.
- CLI: `accounts`, `scan`, `resources`, `findings` commands (graph export can be V1).

**Explicitly NOT in MVP**: multi-account UI, AWS Organizations, scheduled/recurring scans, AI explanations, SSO, multi-tenant RBAC, Aurora/EKS/DynamoDB/etc., NAT/ALB metrics if time-constrained (see above), dark mode toggle (Tailwind dark classes present but no switcher UI).

---

## U. V1 / V2 Roadmap

**V1** (next after MVP proves itself):
- More services: EKS, DynamoDB, ElastiCache, Aurora, Auto Scaling Groups, EFS, snapshots, SNS, EventBridge, Route53, ECR, NLB.
- Multiple accounts (manual add, one at a time) with an account-switcher in the UI.
- Scheduled scans (e.g. nightly cron via pg-boss's built-in scheduling, or EventBridge Scheduler → API).
- Graph export (CLI + UI download as JSON/PNG).
- SSO/OIDC login.
- CLI standalone local-scan mode (if still wanted, now that core logic is proven — reimplementation risk is lower once interfaces are stable).
- Estimated cost coverage expanded to S3 (storage-class aware), Lambda (invocation-based), SQS.

**V2:**
- AWS Organizations integration (bulk account onboarding).
- Cost Explorer resource-level granularity where available (tag-based cost allocation).
- Move job queue from pg-boss to SQS if scan concurrency/volume genuinely outgrows single-worker-fleet pg-boss throughput (see §Y).
- AI explanation layer (§26 of spec) — consumes existing `Finding.evidence`, purely additive, no new data collection required.
- Multi-tenant RBAC if the platform is offered beyond one internal team.
- Historical trend views (resource count / cost over time — `cost_snapshots` and `metrics` history already support this; V2 is mostly a frontend + query-layer effort, not new data collection).

**Future (unscoped, explicitly not planned):**
- Any AWS mutation capability (explicitly against product principles — if ever considered, it's a different product with a different trust model).
- Real-time/streaming resource change detection (EventBridge-based near-live updates instead of scan-triggered) — big architecture shift, only worth it if "scan-based, minutes-old data" becomes a proven pain point.

---

## V. Repository Structure

```text
infra-explorer/
├── apps/
│   ├── web/                 # Next.js frontend
│   ├── api/                 # NestJS API server
│   └── worker/              # NestJS-based worker process (scan orchestration)
├── packages/
│   ├── aws-scanner/         # scanners + normalization + credentials + retry/pagination
│   ├── domain/               # shared TS types: Resource, Relationship, Scan, Finding, etc.
│   │                          # (imported by web, api, worker, cli — single source of truth)
│   ├── rules/                # waste detection rule engine (pure functions)
│   ├── cost/                 # pricing tables + cost estimation + Cost Explorer client
│   ├── db/                   # Prisma/Drizzle schema + migrations + repository layer
│   └── shared/                # logging, config, error types
├── cli/                      # infra-explorer CLI (API client, see §P)
├── infra/
│   ├── control-account/      # Terraform: ECS, RDS, ALB, CloudFront, ECR, IAM for the platform itself
│   └── target-account/       # Terraform module customers apply: InfraExplorerReadOnly role + trust policy
└── docs/
    ├── ARCHITECTURE_PLAN.md  # this document
    └── runbooks/
```

`packages/domain` is the load-bearing piece that makes "one language, no duplicated logic" actually true — web, api, worker, and cli all import the same `Resource`/`Finding`/`Scan` types, so a schema change is one edit, not four.

---

## W. Implementation Phases

Each phase lists objective, tasks, affected modules, dependencies, and acceptance criteria.

### Phase 0 — Foundations
- **Objective**: monorepo scaffolding, no product logic yet.
- **Tasks**: pnpm+Turborepo setup; `packages/domain` with initial types; `packages/db` with Prisma/Drizzle + `accounts`/`scans` tables only; empty NestJS `apps/api` and `apps/worker`; empty Next.js `apps/web`; CI pipeline (lint+typecheck+test on PR).
- **Modules**: all `apps/*` skeletons, `packages/domain`, `packages/db`.
- **Dependencies**: none.
- **Acceptance**: `pnpm build` succeeds across all packages; CI green on an empty test suite; `docker-compose up` runs Postgres + api + worker locally.

### Phase 1 — AWS Authentication
- **Objective**: register an account and successfully assume its role.
- **Tasks**: `accounts` table + `POST/GET /accounts`, `POST /accounts/:id/verify`; `packages/aws-scanner/credentials.ts` (assume-role provider with ExternalId); Terraform module for `target-account` role.
- **Dependencies**: Phase 0.
- **Acceptance**: given a real (test) AWS account with the role deployed, `verify` returns ACTIVE; invalid role ARN / wrong ExternalId returns a clear INVALID error, never a raw AWS SDK stack trace to the client.

### Phase 2 — Resource Discovery (Scanners)
- **Objective**: EC2 + EBS + VPC scanners producing normalized resources, callable directly (no async/worker yet).
- **Tasks**: `resources` table; EC2/EBS/VPC scanners + normalizers; pagination/retry/backoff helpers; scanner registry.
- **Dependencies**: Phase 1.
- **Acceptance**: running the EC2 scanner against a test account returns correctly normalized `Resource[]` matching the schema in §D; a simulated throttle triggers backoff+retry, not failure.

### Phase 3 — Database & Persistence
- **Objective**: persist scan results idempotently.
- **Tasks**: repository layer for upserting resources by `(account_id, region, service, external_id)`; soft-delete resources not seen in latest scan; indexes from §E.
- **Dependencies**: Phase 2.
- **Acceptance**: running the same scan twice does not duplicate rows; a resource removed from AWS between scans is marked `is_deleted`, not deleted from the DB.

### Phase 4 — Resource Graph (Relationships)
- **Objective**: relationship engine + `GET /resources/:id/relationships`, `GET /graph`.
- **Tasks**: relationship engine per §G for EC2/EBS/VPC edges; graph query endpoint with mandatory account filter + node cap.
- **Dependencies**: Phase 3.
- **Acceptance**: for a test account with an EC2 instance in a subnet with a security group and an attached volume, `GET /graph` returns the 4 nodes and 3 edges correctly typed.

### Phase 5 — Frontend (Overview + Graph + Resource Explorer, no findings/cost yet)
- **Objective**: all three pages rendering real discovered data.
- **Tasks**: `apps/web` pages per §L; React Flow graph with dagre layout; resource table with filters; detail drawer (resource fields only, no findings/cost sections yet).
- **Dependencies**: Phase 4.
- **Acceptance**: a user can log in, see the Overview counts, click into the Graph, pan/zoom/click a node, and see it in the Resource Explorer table with working filters.

### Phase 6 — CloudWatch Metrics
- **Objective**: metrics engine for EC2/RDS.
- **Tasks**: `metrics` table (partitioned); batched `GetMetricData` calls; daily rollup storage; RDS scanner added.
- **Dependencies**: Phase 3 (needs resources to attach metrics to).
- **Acceptance**: after a scan, an EC2 instance's `metrics` rows show a 30-day daily CPU average matching a manually-checked CloudWatch console value.

### Phase 7 — Waste Detection
- **Objective**: rule engine producing the MVP finding set.
- **Tasks**: `findings` table; `packages/rules` with the 3–6 MVP rules from §I; upsert-per-scan logic; findings panel in Overview + findings column in Resource Explorer + finding section in detail drawer.
- **Dependencies**: Phase 6 (utilization rules need metrics), Phase 3 (config rules like unattached EBS don't, could ship earlier if sequencing needs it).
- **Acceptance**: a deliberately idle test EC2 instance and an unattached test EBS volume both produce correct findings with accurate evidence payloads after a scan.

### Phase 8 — Cost Analysis
- **Objective**: cost engine (actual + estimated), Overview cost cards, per-resource estimated cost in detail drawer.
- **Tasks**: `cost_snapshots` table; Cost Explorer client (`ce:GetCostAndUsage`); static pricing table for EC2/RDS/EBS + estimation logic in `packages/cost`; wire potential-savings into findings.
- **Dependencies**: Phase 7 (savings numbers reference findings), Phase 3.
- **Acceptance**: Overview shows actual account cost from Cost Explorer and a separately-labeled estimated run-rate; an idle EC2 finding shows its estimated monthly cost as its potential saving.

### Phase 9 — Async Scan System
- **Objective**: move scanning off the request thread (this can technically move earlier — see note — but is placed here so Phases 2–8 can be built/tested synchronously first, which is much faster to iterate on).
- **Tasks**: introduce pg-boss; `POST /scans` enqueues + returns 202; worker process consumes jobs; scan status polling; partial-success service-result tracking (§17).
- **Dependencies**: Phases 2–8 (wraps the whole pipeline).
- **Acceptance**: triggering a scan returns in <200ms; scan status transitions QUEUED→RUNNING→SUCCESS/PARTIAL_SUCCESS are visible via polling; a forced failure in one scanner (e.g. simulated CloudFront throttle) still yields PARTIAL_SUCCESS with other services intact.

  *Sequencing note*: it is entirely reasonable to build Phase 9's queue skeleton right after Phase 0 and run everything through it from Phase 2 onward, if the team prefers not to retrofit async later. Both orderings are valid; the plan above optimizes for fastest visible progress during solo/small-team development.

### Phase 10 — CLI
- **Objective**: CLI commands per §P, calling the now-complete API.
- **Tasks**: `cli/` package; auth token flow; `accounts`/`scan`/`resources`/`findings` commands.
- **Dependencies**: Phases 1–9 (needs a stable, complete API).
- **Acceptance**: `infra-explorer scan --account production --regions us-west-2` triggers the same scan as the UI button and prints status until terminal.

### Phase 11 — Deployment
- **Objective**: platform running on AWS per §Q.
- **Tasks**: Terraform for control-account infra; ECR + CI/CD pipeline; Secrets Manager wiring; CloudFront+S3 for frontend.
- **Dependencies**: functionally independent of 2–10's content but practically done after MVP feature-complete, or in parallel by a second engineer from Phase 0 onward.
- **Acceptance**: a fresh `terraform apply` stands up the full stack; a merge to main deploys via CI without manual steps beyond the `apply` approval gate.

### Phase 12 — Observability & Hardening
- **Objective**: production-readiness pass.
- **Tasks**: structured logging finalized; CloudWatch metrics/dashboards from §R; rate limiting; audit log; security review of IAM policies (least-privilege pass on both `InfraExplorerReadOnly` and the worker's own task role).
- **Dependencies**: Phase 11.
- **Acceptance**: a dashboard shows scan success rate, API latency, and throttle counts; a rate-limit test confirms `POST /scans` is capped per user.

---

## X. Engineering Backlog

Prioritized; roughly in the order to pull tickets, grouped by phase.

```text
INFRA-001
Title: Monorepo scaffolding (pnpm + Turborepo)
Description: Set up apps/{web,api,worker}, packages/{domain,db,shared} with build/lint/test wired through Turborepo.
Dependencies: none
Acceptance Criteria: `pnpm install && pnpm build && pnpm test` succeeds from repo root; CI runs the same on PR.
Estimated Complexity: S

INFRA-002
Title: Domain types package
Description: Define Account, Region, Resource, Relationship, Scan, Metric, Finding, CostSnapshot TS interfaces in packages/domain per §D.
Dependencies: INFRA-001
Acceptance Criteria: types compile and are imported (even if unused) by web/api/worker without duplication.
Estimated Complexity: S

INFRA-003
Title: Postgres schema + migrations (accounts, scans)
Description: Implement §E schema for accounts and scans tables only, via Prisma/Drizzle migrations.
Dependencies: INFRA-002
Acceptance Criteria: migration runs clean on a fresh DB; docker-compose Postgres included for local dev.
Estimated Complexity: S

INFRA-004
Title: Account registration + verification API
Description: POST /accounts, GET /accounts, POST /accounts/:id/verify implementing assume-role check with ExternalId.
Dependencies: INFRA-003
Acceptance Criteria: verifying a correctly-configured test account returns ACTIVE; wrong ExternalId returns INVALID with a safe error message.
Estimated Complexity: M

INFRA-005
Title: Target-account IAM Terraform module
Description: infra/target-account module producing InfraExplorerReadOnly role + trust policy with ExternalId condition.
Dependencies: none (parallel to INFRA-004)
Acceptance Criteria: applying the module in a test account produces a role InfraExplorerReadOnly assumable only with the correct ExternalId.
Estimated Complexity: S

INFRA-006
Title: STS credential provider + retry/backoff/pagination helpers
Description: packages/aws-scanner credentials.ts, retry.ts, pagination.ts per §F/§17.
Dependencies: INFRA-004
Acceptance Criteria: unit tests simulate ThrottlingException and verify exponential backoff+jitter retry behavior; credentials auto-refresh before expiry.
Estimated Complexity: M

INFRA-007
Title: EC2 + EBS scanners and normalizers
Description: Implement scan() + normalize for EC2 instances and EBS volumes per §D schema.
Dependencies: INFRA-006
Acceptance Criteria: unit tests against captured/mocked DescribeInstances and DescribeVolumes fixtures produce correct normalized output.
Estimated Complexity: M

INFRA-008
Title: VPC scanner (subnets, SGs, route tables, IGW, NAT GW)
Description: Implement scan() + normalize for VPC sub-resources.
Dependencies: INFRA-006
Acceptance Criteria: unit tests cover all sub-types; each produces a distinct `type` value under service='VPC'.
Estimated Complexity: M

INFRA-009
Title: resources table + upsert repository layer
Description: Implement §E resources table and upsert-by-natural-key logic with soft-delete for resources absent from latest scan.
Dependencies: INFRA-007, INFRA-008
Acceptance Criteria: re-running a scan with identical input produces zero duplicate rows; removing a resource from mocked AWS response between two scan runs marks it is_deleted=true.
Estimated Complexity: M

INFRA-010
Title: Relationship engine (EC2/EBS/VPC edges)
Description: Build relationships table + engine deriving EC2→Subnet/SG/EBS edges and subnet→VPC edges per §G.
Dependencies: INFRA-009
Acceptance Criteria: given a fixture resource set, engine produces exactly the expected edge set (asserted in a unit test).
Estimated Complexity: M

INFRA-011
Title: GET /resources, GET /resources/:id, GET /resources/:id/relationships
Description: Implement resource listing with filters (service/region/environment/state/search) and detail endpoints.
Dependencies: INFRA-009, INFRA-010
Acceptance Criteria: filters combine correctly (AND semantics); pagination works past 50 items; search matches on name via trigram index.
Estimated Complexity: M

INFRA-012
Title: GET /graph endpoint
Description: Graph query with mandatory account filter, optional region/service/environment filters, hard node cap with clear over-limit response.
Dependencies: INFRA-010
Acceptance Criteria: exceeding the node cap returns a structured "narrow your filters" response, not a truncated silent result.
Estimated Complexity: M

INFRA-013
Title: Frontend shell + auth
Description: Next.js app shell, basic login (email/password), protected routes.
Dependencies: INFRA-001
Acceptance Criteria: unauthenticated access to any page redirects to login; session persists across reload.
Estimated Complexity: M

INFRA-014
Title: Overview page (resource counts only, no cost/findings yet)
Description: Implement AccountSummaryCards + ResourceCountByService against GET /resources aggregation.
Dependencies: INFRA-011, INFRA-013
Acceptance Criteria: counts match a manual DB query for a seeded test account.
Estimated Complexity: M

INFRA-015
Title: Infrastructure Map page (React Flow + dagre)
Description: InfraGraph component consuming GET /graph, with pan/zoom/search/filter UI and ResourceNode renderer.
Dependencies: INFRA-012, INFRA-013
Acceptance Criteria: for a seeded test account, graph renders correct nodes/edges; filtering by region visibly updates the graph; clicking a node opens the detail drawer.
Estimated Complexity: L

INFRA-016
Title: Resource Explorer page
Description: Virtualized, filterable/searchable resource table.
Dependencies: INFRA-011, INFRA-013
Acceptance Criteria: table handles 1,000+ seeded rows without jank (virtualization confirmed); all filters from §K work.
Estimated Complexity: M

INFRA-017
Title: Shared Resource Detail Drawer
Description: One component used by both graph and table; renders normalized fields per resource type.
Dependencies: INFRA-015, INFRA-016
Acceptance Criteria: opening the same resource from graph vs table shows identical content.
Estimated Complexity: M

INFRA-018
Title: metrics table + GetMetricData batching engine
Description: Implement §H metrics engine for EC2 (CPU/Network) with monthly partitioning.
Dependencies: INFRA-009
Acceptance Criteria: batched call retrieves CPU+Network for 50+ mocked instances in a single GetMetricData call in tests; daily rollups stored correctly.
Estimated Complexity: L

INFRA-019
Title: RDS scanner + RDS metrics
Description: RDS instance scanner/normalizer + CPU/Connections/FreeableMemory metrics.
Dependencies: INFRA-006, INFRA-018
Acceptance Criteria: RDS resources appear in resources table with correct relationships (subnet group, SG) and metrics.
Estimated Complexity: M

INFRA-020
Title: Rule engine core + POSSIBLE_IDLE_INSTANCE, UNATTACHED_EBS, UNUSED_ELASTIC_IP
Description: findings table + packages/rules with the three highest-signal MVP rules.
Dependencies: INFRA-018 (idle rule needs metrics), INFRA-009 (config rules don't)
Acceptance Criteria: fixture-based tests confirm each rule fires/doesn't fire correctly at its threshold boundary.
Estimated Complexity: M

INFRA-021
Title: Findings API + UI (Overview findings panel, table column, drawer section)
Description: GET /findings + surfacing findings across all three pages with confidence/severity badges.
Dependencies: INFRA-020, INFRA-014/016/017
Acceptance Criteria: a seeded idle instance shows its finding consistently in all three surfaces with matching evidence.
Estimated Complexity: M

INFRA-022
Title: Cost Explorer integration (actual cost)
Description: ce:GetCostAndUsage client + cost_snapshots (ACCOUNT/SERVICE scope, source=COST_EXPLORER).
Dependencies: INFRA-004
Acceptance Criteria: Overview shows actual monthly cost by service matching Cost Explorer console for a test account.
Estimated Complexity: M

INFRA-023
Title: Pricing estimation engine (EC2/RDS/EBS)
Description: Cached pricing table + per-resource estimated cost calculation, source=PRICING_ESTIMATE.
Dependencies: INFRA-009
Acceptance Criteria: a known t3.large running 720 hours in us-west-2 estimates within an acceptable tolerance of published On-Demand pricing.
Estimated Complexity: M

INFRA-024
Title: Wire potential savings into findings + cost UI labeling
Description: Findings reference estimated cost as potential savings; UI clearly separates Actual/Estimated/Savings everywhere per principle #6.
Dependencies: INFRA-021, INFRA-022, INFRA-023
Acceptance Criteria: no UI surface shows a dollar amount without an Actual/Estimated label.
Estimated Complexity: S

INFRA-025
Title: pg-boss job queue + async scan execution
Description: Move ScanOrchestrator invocation behind a queued job; POST /scans returns 202 immediately; scan status polling.
Dependencies: all scanning/rules/cost phases (wraps existing synchronous pipeline)
Acceptance Criteria: POST /scans returns in <200ms; status transitions correctly; concurrent scans for different accounts don't block each other.
Estimated Complexity: M

INFRA-026
Title: Partial-failure handling per service
Description: Per-service try/catch in orchestrator; service_results tracking; PARTIAL_SUCCESS status logic.
Dependencies: INFRA-025
Acceptance Criteria: forcing one scanner to throw in a test still yields PARTIAL_SUCCESS with correct per-service status breakdown.
Estimated Complexity: M

INFRA-027
Title: Remaining MVP scanners (ECS, ALB, S3, Lambda, SQS, CloudFront)
Description: Implement scan/normalize for the remaining 6 MVP services + their relationships (ALB→TG→ECS/EC2, ECS→cluster/taskdef, CloudFront→origin).
Dependencies: INFRA-010 (relationship pattern established)
Acceptance Criteria: a seeded multi-tier fixture (CloudFront→ALB→ECS→RDS) produces the exact graph shown in the product spec's example.
Estimated Complexity: L

INFRA-028
Title: Additional waste rules (oversized RDS, low-usage ALB, low-usage NAT)
Description: Extend packages/rules per §I remaining rules.
Dependencies: INFRA-020, INFRA-027
Acceptance Criteria: each rule has fixture-based boundary tests.
Estimated Complexity: M

INFRA-029
Title: CLI package (accounts/scan/resources/findings commands)
Description: Thin API client CLI per §P.
Dependencies: API feature-complete through INFRA-028
Acceptance Criteria: every documented CLI command works against a running local backend.
Estimated Complexity: M

INFRA-030
Title: Terraform for control-account deployment
Description: ECS Fargate (api+worker), RDS, ALB, CloudFront+S3, ECR, Secrets Manager wiring.
Dependencies: none (parallelizable from early on)
Acceptance Criteria: terraform apply stands up a working environment from scratch.
Estimated Complexity: L

INFRA-031
Title: CI/CD pipeline
Description: GitHub Actions build/test/deploy pipeline with manual approval gate on infra apply.
Dependencies: INFRA-030
Acceptance Criteria: a merge to main deploys api+worker+web without manual steps beyond approval.
Estimated Complexity: M

INFRA-032
Title: Observability pass (structured logs, CloudWatch metrics, dashboards)
Description: Implement §R metrics emission and a baseline CloudWatch dashboard.
Dependencies: INFRA-025 (needs the scan pipeline to instrument)
Acceptance Criteria: dashboard shows live scan_duration, resources_discovered, aws_api_throttles for a real test scan.
Estimated Complexity: M

INFRA-033
Title: Security hardening pass
Description: Rate limiting on /scans and /accounts/:id/verify, audit log table + writes, ARN input validation, least-privilege review of both IAM roles.
Dependencies: feature-complete MVP
Acceptance Criteria: rate limit test passes; malformed roleArn input rejected before any AWS call; audit_log captures account/scan actions.
Estimated Complexity: M
```

---

## Y. Risks and Trade-offs

| Risk | Impact | Mitigation |
|---|---|---|
| **AWS API throttling** during large-account scans | Incomplete/slow scans | Per-service concurrency limits, exponential backoff+jitter, `GetMetricData` batching, partial-success model so one throttled service doesn't sink the scan (§17) |
| **Cost Explorer limitations** (24h+ data lag, resource-level granularity requires cost allocation tags to be enabled, which many accounts haven't done) | "Actual cost" may be stale or account-level only | Always label data recency and granularity in the UI; never silently fall back to estimated numbers labeled as actual |
| **CloudWatch API cost** at scale (many accounts × many resources × many metrics) | Real, non-trivial AWS bill for the platform's own operation | Batch aggressively via `GetMetricData`, cache daily rollups (don't re-fetch unchanged historical windows on every scan — only fetch the new day(s) since last scan), keep metric set minimal (§H) |
| **Resource relationship accuracy** | Wrong edges → misleading graph, erodes trust fast | Prefer `VERIFIED` (direct API field) relationships; keep `INFERRED` edges rare and visually distinguished in the UI (e.g. dashed line) so users can tell fact from guess |
| **Global vs regional resource handling** | Duplicate resources or wasted API calls if mishandled | Explicit `scope` tag per scanner (§F/§O), global scanners run once per scan not once per region |
| **Stale data between scans** | User acts on minutes/hours-old state | Always show "last scanned at" prominently; this is inherent to a scan-based (not streaming) architecture — an accepted trade-off for MVP simplicity, revisit only if it becomes a real pain point (§U Future) |
| **IAM security** (over-broad read role, ExternalId misuse, ARN injection) | Cross-account security incident — the highest-severity risk category for this product | Hand-scoped least-privilege policy (not `ReadOnlyAccess`), mandatory ExternalId, strict ARN input validation, rate-limited verify endpoint (§N) |
| **Multi-account complexity** growing faster than the schema/queue can handle | pg-boss/single-worker model bottlenecks; UI assumes "current account" mental model that breaks at scale | Schema already multi-account-ready (§D); revisit queue choice (→ SQS) and add bulk/parallel scan scheduling only when actual account count creates measured contention, not preemptively |
| **Graph performance** at high node/edge counts | Sluggish or unusable UI | Mandatory server-side filtering + hard node cap on `GET /graph` (§L); push complexity to query time, not client rendering |
| **Relationship prune cost** at high edge counts | Each scan's account-wide edge prune (`discovered_in_scan_id IS DISTINCT FROM scanId` + EXISTS-join to `resources` for account scoping) can't use an index as written, so it scans the whole `relationships` table per build | Fine at MVP scale (thousands of edges). When it matters (V1/V2), denormalize `account_id` onto `relationships` and index `(account_id, discovered_in_scan_id)`, dropping the EXISTS join — noted in the INFRA-010 `pruneStale` implementation |
| **Database growth**, specifically the `metrics` table | Unbounded growth, slow queries over time | Monthly partitioning + 90-day retention with scheduled partition drop (§E/§H) — this is the one table that needs this treatment; `resources`/`findings`/`relationships` grow linearly with resource count, not resource count × time, and don't need partitioning at MVP/V1 scale |
| **Confusing estimated savings with guaranteed savings** | Loss of user trust, or worse, someone acting on bad information (e.g., terminating a resource that wasn't actually idle) | Confidence taxonomy enforced at the data model level (`findings.confidence` is not optional), UI copy always hedges ("possible," "estimated," "~") per product principles §25 |

---

## Z. Final Recommendation

Build exactly what's below, in this order, and nothing more, until it's working end-to-end for one real AWS account.

### 1. Recommended architecture
TypeScript monorepo (pnpm + Turborepo): Next.js frontend, NestJS API, NestJS-based worker, all sharing `packages/domain`/`packages/aws-scanner`/`packages/rules`/`packages/cost`/`packages/db`. PostgreSQL is the only stateful dependency (data + job queue via pg-boss). ECS Fargate for api/worker, RDS for Postgres, CloudFront+S3 for the frontend, deployed via Terraform. Cross-account access exclusively via `sts:AssumeRole` with mandatory ExternalId — no long-lived keys anywhere.

### 2. MVP scope
10 services (EC2, EBS, VPC+subresources, RDS, ECS, ALB, S3, Lambda, SQS, CloudFront), 3 required + 3 stretch waste rules, single account/multi-region, manual scan trigger, all 3 frontend pages, CLI with accounts/scan/resources/findings commands, actual (Cost Explorer) + estimated (pricing model) cost clearly separated. Full detail in §T.

### 3. Repository structure
As laid out in §V — `apps/{web,api,worker}`, `packages/{domain,aws-scanner,rules,cost,db,shared}`, `cli/`, `infra/{control-account,target-account}`.

### 4. Database schema
As laid out in §E — 7 tables (`accounts`, `scans`, `resources`, `relationships`, `metrics`, `findings`, `cost_snapshots`) plus pg-boss's own schema. `resources` is a single polymorphic table with `jsonb metadata`, not per-type tables. `metrics` is partitioned monthly with 90-day retention.

### 5. API design
REST under `/api/v1`, as in §K — account registration/verification, async scan trigger + status polling, filtered resource listing/detail/relationships, capped graph query, findings listing, cost summary.

### 6. AWS scanner design
One `ResourceScanner` per service (§F), tagged `REGIONAL`/`GLOBAL`, running normalization inline, returning partial results + errors rather than throwing, orchestrated with per-service concurrency limits and shared retry/backoff.

### 7. Waste detection rules
`POSSIBLE_IDLE_INSTANCE`, `UNATTACHED_EBS`, `UNUSED_ELASTIC_IP` first (highest signal, lowest complexity); then `POSSIBLE_OVERSIZED_RDS`, `LOW_USAGE_LOAD_BALANCER`, `LOW_USAGE_NAT_GATEWAY`. Every finding carries a `VERIFIED|INFERRED|ESTIMATED|UNKNOWN` confidence tag — non-negotiable per product principles.

### 8. Implementation phases
13 phases (§W), Phase 0 (scaffolding) through Phase 12 (observability/hardening), with the async job system (Phase 9) deliberately placed after the core synchronous pipeline works, to keep early iteration fast — though building it earlier is a valid alternative if preferred.

### 9. Prioritized backlog
33 tickets (§X), INFRA-001 through INFRA-033, ordered so each is buildable/testable against the previous.

### 10. First 10 tasks to implement
```text
1. INFRA-001 — Monorepo scaffolding
2. INFRA-002 — Domain types package
3. INFRA-003 — Postgres schema (accounts, scans)
4. INFRA-005 — Target-account IAM Terraform module   (parallel-safe with #4 below)
5. INFRA-004 — Account registration + verification API
6. INFRA-006 — STS credential provider + retry/backoff/pagination helpers
7. INFRA-007 — EC2 + EBS scanners and normalizers
8. INFRA-008 — VPC scanner
9. INFRA-009 — resources table + upsert repository layer
10. INFRA-010 — Relationship engine (EC2/EBS/VPC edges)
```
By the end of task 10, you can run a real (synchronous, no queue yet) scan against a test AWS account and see correctly normalized, related resources sitting in Postgres — the proof point that the hardest architectural bets (normalization, relationships, read-only cross-account auth) work, before any pixel of UI or line of rule-engine code is written.
