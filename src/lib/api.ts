/** Browser-side API client for the super-admin panel.
 *
 * Auth model: httpOnly cookies set by sentry-backend on login. Every request
 * uses `credentials: "include"` so the cookie rides along. This requires the
 * backend to (a) list this SPA's origin in `ALLOWED_ORIGINS` and (b) be served
 * same-site in production (e.g. admin.sentry.chipmo.mn + api.sentry.chipmo.mn)
 * so the SameSite=Lax cookie is sent on cross-subdomain fetches. See README. */

import type {
  AdminStats,
  AiNodePairingCode,
  AiNodePublic,
  AiNodeUpdate,
  BehaviorConfig,
  BehaviorConfigPatch,
  DimensionCreate,
  DimensionUpdate,
  LeadPublic,
  LeadUpdate,
  LoginResponse,
  OrganizationPublic,
  OrgMemberPublic,
  UserAdminUpdate,
  UserInviteInput,
  UserPublic,
} from "./types";

// Empty default → all requests are relative and flow through the same-origin
// proxy (server.mjs in prod, Vite `server.proxy` in dev), so the backend's
// host-only SameSite=Lax cookie is sent. Do NOT set VITE_API_BASE_URL to an
// absolute cross-site host — that drops the cookie and breaks admin login.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // body wasn't JSON — keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const auth = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<UserPublic>("/api/v1/auth/me"),
};

export const admin = {
  stats: () => request<AdminStats>("/api/v1/admin/stats"),

  listOrgs: () => request<OrganizationPublic[]>("/api/v1/admin/orgs"),
  createOrg: (body: { name: string; slug: string }) =>
    request<OrganizationPublic>("/api/v1/admin/orgs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getOrg: (orgId: string) =>
    request<OrganizationPublic>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}`,
    ),
  listOrgMembers: (orgId: string) =>
    request<OrgMemberPublic[]>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/members`,
    ),

  listUsers: () => request<UserPublic[]>("/api/v1/admin/users"),
  inviteUser: (body: UserInviteInput) =>
    request<UserPublic>("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateUser: (userId: string, body: UserAdminUpdate) =>
    request<UserPublic>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listLeads: () => request<LeadPublic[]>("/api/v1/admin/leads"),
  updateLead: (leadId: string, body: LeadUpdate) =>
    request<LeadPublic>(`/api/v1/admin/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listAiNodes: () => request<AiNodePublic[]>("/api/v1/admin/ai-nodes"),
  createAiNodePairingCode: () =>
    request<AiNodePairingCode>("/api/v1/admin/ai-nodes/pairing-codes", {
      method: "POST",
    }),
  revokeAiNode: (nodeId: string) =>
    request<void>(`/api/v1/admin/ai-nodes/${encodeURIComponent(nodeId)}/revoke`, {
      method: "POST",
    }),
  updateAiNode: (nodeId: string, body: AiNodeUpdate) =>
    request<AiNodePublic>(`/api/v1/admin/ai-nodes/${encodeURIComponent(nodeId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  nodeMetrics: (nodeId: string, range: string) =>
    request<NodeMetric[]>(
      `/api/v1/admin/ai-nodes/${encodeURIComponent(nodeId)}/metrics?range=${encodeURIComponent(range)}`,
    ),
  alertAnalytics: (range: string) =>
    request<AlertAnalytics>(
      `/api/v1/admin/analytics/alerts?range=${encodeURIComponent(range)}`,
    ),
};

/** Alert breakdown for the dashboard (docs/19 Phase 2). */
export interface AlertAnalytics {
  total: number;
  by_category: Record<string, number>;
  by_level: Record<string, number>;
  by_day: { day: string; count: number }[];
}

/** One resource sample from the AI-node metrics time-series (docs/19). */
export interface NodeMetric {
  ts: string;
  cpu_pct: number | null;
  ram_used_mb: number | null;
  ram_total_mb: number | null;
  gpu_pct: number | null;
  vram_used_mb: number | null;
  vram_total_mb: number | null;
  gpu_temp_c: number | null;
  fps_inference: number | null;
  active_cameras: number | null;
}

export const behaviors = {
  get: () => request<BehaviorConfig>("/api/v1/behaviors"),
  patch: (body: BehaviorConfigPatch) =>
    request<BehaviorConfig>("/api/v1/behaviors", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addDimension: (body: DimensionCreate) =>
    request<BehaviorConfig>("/api/v1/behaviors/dimensions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDimension: (key: string, body: DimensionUpdate) =>
    request<BehaviorConfig>(
      `/api/v1/behaviors/dimensions/${encodeURIComponent(key)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteDimension: (key: string) =>
    request<BehaviorConfig>(
      `/api/v1/behaviors/dimensions/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ),
};
