import type {
  Account,
  AccountVerificationResult,
  CostSummary,
  Graph,
  Paginated,
  Resource,
  ResourceRelationships,
  ResourceSummary,
  Scan,
} from "@infra-explorer/domain";

/** Response from POST /accounts — includes the generated ExternalId to trust. */
export interface RegisterAccountResponse {
  account: Account;
  externalId: string;
  workerRoleArn: string;
}

export interface CreateAccountInput {
  displayName: string;
  awsAccountId: string;
  roleArn: string;
  enabledRegions: string[];
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Error carrying the API's structured field errors (from Zod validation). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      details?: { fieldErrors?: Record<string, string[]> };
    };
    throw new ApiError(
      body.message ?? `Request failed: ${res.status}`,
      body.details?.fieldErrors,
    );
  }
  // 204 No Content has no body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (entries.length === 0) return "";
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")}`;
}

export interface OverviewResponse {
  countsByService: Array<{ service: string; count: number }>;
  totalResources: number;
}

export type GraphResponse =
  | { overLimit: true; nodeCount: number; cap: number }
  | Graph;

export const api = {
  accounts: (): Promise<Account[]> => get("/accounts"),

  createAccount: (body: CreateAccountInput): Promise<RegisterAccountResponse> =>
    post("/accounts", body),

  verifyAccount: (id: string): Promise<AccountVerificationResult> =>
    post(`/accounts/${id}/verify`, {}),

  deleteAccount: (id: string): Promise<void> => del(`/accounts/${id}`),

  overview: (accountId: string, region?: string): Promise<OverviewResponse> =>
    get(`/overview${qs({ accountId, region })}`),

  resources: (params: {
    accountId?: string;
    service?: string;
    region?: string;
    type?: string;
    state?: string;
    environment?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<ResourceSummary>> =>
    get(`/resources${qs(params)}`),

  resource: (id: string): Promise<Resource> => get(`/resources/${id}`),

  resourceRelationships: (id: string): Promise<ResourceRelationships> =>
    get(`/resources/${id}/relationships`),

  graph: (params: {
    accountId: string;
    region?: string;
    service?: string;
    environment?: string;
  }): Promise<GraphResponse> => get(`/graph${qs(params)}`),

  cost: (accountId: string): Promise<CostSummary> =>
    get(`/cost${qs({ accountId })}`),

  triggerScan: (
    accountId: string,
    regions?: string[],
  ): Promise<{ scanId: string; status: string }> =>
    post("/scans", { accountId, regions }),

  scan: (id: string): Promise<Scan> => get(`/scans/${id}`),

  scans: (accountId: string): Promise<Scan[]> =>
    get(`/scans${qs({ accountId })}`),
};
