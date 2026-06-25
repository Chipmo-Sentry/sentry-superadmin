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
  BillingAnalytics,
  BillingOverview,
  CreditRequest,
  JournalEntryPublic,
  PromoCodeCreate,
  PromoCodePublic,
  PromoCodeUpdate,
  TopupRequest,
  DimensionCreate,
  DimensionUpdate,
  EventLogPublic,
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

// Single-flight access-token refresh. The access cookie lives ~15 min; the
// refresh cookie ~7 days (Path=/api/v1/auth). Without this, every WRITE
// (PATCH/POST/DELETE) starts returning 401 once the access token expires while
// the panel stays open. Because GET /behaviors is PUBLIC, the page still shows
// data — so it looks like "enabling/saving just errors" ("Шинэчилж чадсангүй")
// rather than a logged-out state. On a 401 we refresh once (collapsing
// concurrent 401s into a single refresh) and retry the original request.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  // Access token expired → refresh once and retry. Skip the auth endpoints
  // themselves so a failing refresh/login can't loop.
  if (res.status === 401 && !retried && !path.startsWith("/api/v1/auth/")) {
    if (await refreshAccessToken()) {
      return request<T>(path, init, true);
    }
  }
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
  deleteAiNode: (nodeId: string) =>
    request<void>(`/api/v1/admin/ai-nodes/${encodeURIComponent(nodeId)}`, {
      method: "DELETE",
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
  feedbackAnalytics: (range: string) =>
    request<FeedbackAnalytics>(
      `/api/v1/admin/analytics/feedback?range=${encodeURIComponent(range)}`,
    ),
  qualityAnalytics: (range: string) =>
    request<QualityAnalytics>(
      `/api/v1/admin/analytics/quality?range=${encodeURIComponent(range)}`,
    ),

  /** Recent alerts across ALL orgs — one row per problematic clip's pipeline
   * trace (camera → behaviours → VLM → decision → review). Newest first;
   * filtering is done client-side over the fetched window. */
  listAlerts: (limit = 100, offset = 0) =>
    request<AdminAlert[]>(
      `/api/v1/admin/alerts?limit=${limit}&offset=${offset}`,
    ),

  /** Every store across all orgs (id, name, org name, camera count). */
  listStores: () => request<StoreAdminRow[]>("/api/v1/admin/stores"),

  /** Repoint a store's cloud push target (where its agent pushes camera streams).
   * Empty string clears it back to the global AGENT_STREAM_PUSH_URL env. */
  updateStorePushUrl: (storeId: string, agentStreamPushUrl: string | null) =>
    request<StoreAdminRow>(`/api/v1/admin/stores/${encodeURIComponent(storeId)}`, {
      method: "PATCH",
      body: JSON.stringify({ agent_stream_push_url: agentStreamPushUrl }),
    }),

  /** The ONE global edge (agent-pc) behaviour-engine config: raw overrides +
   * version + the effective merged config EVERY store's agents receive. */
  getGlobalEdgeConfig: () =>
    request<EdgeConfigAdminView>("/api/v1/admin/edge-config"),
  /** Set the global edge tunable overrides (partial). Omitted/undefined keys
   * fall back to the agent defaults; an empty body resets to defaults. The
   * version bumps so ALL store agents re-apply within ~one poll. */
  setGlobalEdgeConfig: (body: EdgeConfigOverrides) =>
    request<EdgeConfigAdminView>("/api/v1/admin/edge-config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

// === Global edge config ("Edge тохиргоо") — agent-pc Stage-1 behaviour engine
// tunables, ONE value for all stores (hand-typed, mirrors schemas/edge.py). ===

export interface StoreAdminRow {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  camera_count: number;
  /** Per-store cloud push target; null → global AGENT_STREAM_PUSH_URL env. */
  agent_stream_push_url: string | null;
}

/** The 24 edge tunables + monotonic version (the effective merged config the
 * store agent receives). Field names + defaults mirror EdgeConfigPayload. */
export interface EdgeConfigPayload {
  version: number;
  // Detection
  person_conf: number;
  item_conf: number;
  frame_skip: number;
  // Behaviour signal weights + geometry
  w_holding: number;
  w_conceal: number;
  w_wrist_torso: number;
  // docs/29 zone behaviours
  w_exit_after_conceal: number;
  w_repeated_shelf: number;
  repeated_shelf_threshold: number;
  // per-behaviour timing gates (sec; 0 = every frame)
  interval_holding: number;
  mindur_holding: number;
  interval_wrist_torso: number;
  mindur_wrist_torso: number;
  interval_conceal: number;
  mindur_conceal: number;
  interval_repeated_shelf: number;
  mindur_repeated_shelf: number;
  interval_exit_after_conceal: number;
  mindur_exit_after_conceal: number;
  reach_frac: number;
  near_frac: number;
  min_kp_conf: number;
  // Risk → episode FSM
  decay: number;
  open_risk: number;
  close_risk: number;
  post_quiet_sec: number;
  drop_after_sec: number;
  iou_match: number;
  band_yellow: number;
  band_red: number;
  // Clip recorder ([-3s .. +3s])
  pre_sec: number;
  post_sec: number;
  segment_sec: number;
  keep_sec: number;
  max_clips: number;
  max_age_sec: number;
  // Server handoff
  upload_clips: boolean;
}

/** A partial set of edge tunables — only the keys an operator chose to override
 * for this store. Everything else stays at the agent default. */
export type EdgeConfigOverrides = Partial<Omit<EdgeConfigPayload, "version">>;

export interface EdgeConfigAdminView {
  store_id: string;
  version: number;
  overrides: EdgeConfigOverrides;
  updated_at: string | null;
  effective: EdgeConfigPayload;
}

// === Pipeline ("Урсгал") — per-clip alert trace (hand-typed, mirrors the
// backend AdminAlertRow schema; not from codegen, like NodeMetric above). ===

export type AdminAlertLevel = "ignore" | "log" | "notify" | "review";
export type AdminAlertCategory =
  | "browsing"
  | "cart_pickup"
  | "pocket_conceal"
  | "bag_conceal"
  | "other";
export type AdminAlertTrigger = "manual_upload" | "live_threshold";
export type AdminFeedbackVerdict = "true_positive" | "false_positive" | "unclear";

export interface AdminBehaviorDetail {
  key: string;
  offset_sec: number;
  score: number;
}

export interface AdminAlert {
  id: string;
  clip_id: string;
  created_at: string;
  organization_id: string;
  organization_name: string;
  store_id: string | null;
  store_name: string | null;
  camera_id: string | null;
  camera_name: string | null;
  category: AdminAlertCategory;
  actions: string[] | null;
  confidence: number;
  reasoning: string;
  model_name: string;
  alert_level: AdminAlertLevel;
  inference_latency_ms: number;
  triggered_by: AdminAlertTrigger;
  person_id: number | null;
  peak_risk_pct: number | null;
  triggered_behaviors: string[] | null;
  triggered_sequences: string[] | null;
  triggered_behavior_detail: AdminBehaviorDetail[] | null;
  feedback_verdict: AdminFeedbackVerdict | null;
}

// === Event / activity log (platform-wide; super-admin sees every org) ===

export interface EventListParams {
  org_id?: string;
  event_type?: string[];
  severity?: string[];
  include_heartbeats?: boolean;
  before?: string; // ISO datetime cursor (created_at <)
  limit?: number;
  offset?: number;
}

function eventQuery(params?: EventListParams): string {
  const q = new URLSearchParams();
  if (params?.org_id) q.set("org_id", params.org_id);
  params?.event_type?.forEach((t) => q.append("event_type", t));
  params?.severity?.forEach((s) => q.append("severity", s));
  if (params?.include_heartbeats) q.set("include_heartbeats", "true");
  if (params?.before) q.set("before", params.before);
  if (params?.limit !== undefined) q.set("limit", String(params.limit));
  if (params?.offset !== undefined) q.set("offset", String(params.offset));
  return q.toString() ? `?${q}` : "";
}

export const events = {
  list: (params?: EventListParams) =>
    request<EventLogPublic[]>(`/api/v1/admin/events${eventQuery(params)}`),
  /** SSE endpoint — open with `new EventSource(url, { withCredentials: true })`
   * and listen for the `log` event. */
  streamUrl: () => `${BASE}/api/v1/admin/events/stream`,
};

/** Feedback-loop breakdown + tuning suggestions (docs/19 Phase 3). */
export interface FeedbackCategoryStat {
  true_positive: number;
  false_positive: number;
  unclear: number;
  total: number;
  fp_rate: number;
}
export interface FeedbackSuggestion {
  category: string;
  fp_rate: number;
  samples: number;
  action: string;
  hint: string;
}
export interface FeedbackAnalytics {
  total: number;
  totals: { true_positive: number; false_positive: number; unclear: number };
  by_category: Record<string, FeedbackCategoryStat>;
  suggestions: FeedbackSuggestion[];
}

/** Detection-quality metrics derived from staff feedback. */
export interface QualityCategoryStat {
  category: string;
  tp: number;
  fp: number;
  unclear: number;
  precision: number | null;
}
export interface QualityConfidenceBucket {
  bucket: string;
  tp: number;
  fp: number;
  tp_rate: number | null;
}
export interface QualityAnalytics {
  range: string;
  total_alerts: number;
  labeled: number;
  coverage: number;
  tp: number;
  fp: number;
  unclear: number;
  precision: number | null;
  by_category: QualityCategoryStat[];
  by_confidence: QualityConfidenceBucket[];
  false_alerts_per_day: number;
}

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
  // Sentry-project-only (process-scoped) usage, vs the whole-machine fields above.
  sentry_cpu_pct: number | null;
  sentry_ram_mb: number | null;
  sentry_vram_mb: number | null;
}

export const billing = {
  overview: () => request<BillingOverview>("/api/v1/admin/billing/overview"),
  journal: (orgId: string, limit: number, offset: number) =>
    request<JournalEntryPublic[]>(
      `/api/v1/admin/billing/orgs/${encodeURIComponent(orgId)}/journal?limit=${limit}&offset=${offset}`,
    ),
  topup: (orgId: string, body: TopupRequest) =>
    request<JournalEntryPublic>(
      `/api/v1/admin/billing/orgs/${encodeURIComponent(orgId)}/topup`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  grantCredit: (orgId: string, body: CreditRequest) =>
    request<void>(
      `/api/v1/admin/billing/orgs/${encodeURIComponent(orgId)}/credit`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  revokeCredit: (orgId: string) =>
    request<void>(
      `/api/v1/admin/billing/orgs/${encodeURIComponent(orgId)}/credit`,
      { method: "DELETE" },
    ),
  listPromoCodes: () =>
    request<PromoCodePublic[]>("/api/v1/admin/billing/promo-codes"),
  createPromoCode: (body: PromoCodeCreate) =>
    request<PromoCodePublic>("/api/v1/admin/billing/promo-codes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePromoCode: (promoId: string, body: PromoCodeUpdate) =>
    request<PromoCodePublic>(
      `/api/v1/admin/billing/promo-codes/${encodeURIComponent(promoId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  analytics: (range: string) =>
    request<BillingAnalytics>(
      `/api/v1/admin/billing/analytics?range=${encodeURIComponent(range)}`,
    ),
};

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
