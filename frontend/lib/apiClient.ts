const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('prism_token');
}

export function setToken(token: string) {
  localStorage.setItem('prism_token', token);
}

export function clearToken() {
  localStorage.removeItem('prism_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.error;
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object'
          ? Object.values(detail)
              .flatMap((value) => (Array.isArray(value) ? value : [value]))
              .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
              .join('; ')
          : `Request failed with status ${res.status}`;
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name?: string | null };
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
}

export interface ConnectorSummary {
  /** True while a sync is running, from the server rather than local state,
   *  so it survives navigation and is visible in every tab. */
  syncing?: boolean;
  syncProgress?: {
    phase: string;
    message: string;
    completed: number | null;
    total: number | null;
    startedAt: string;
    elapsedMs: number;
  } | null;
  lastRowCount?: number | null;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  id: string;
  type: string;
  displayName: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SyncJob {
  id: string;
  connectorId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: {
    phase: 'preparing' | 'fetching' | 'saving' | 'completed' | 'failed';
    completed: number;
    total: number;
    message: string;
    warning?: string;
  };
  result?: { rowCount?: number; coverage?: { start: string; end: string } | null };
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface QueryPlan {
  intent: string;
  dateRange: string;
  groupBy: string;
  source?: string;
  metrics: string[];
  limit: number;
  interpretation: string;
}

export interface PlanWarning {
  code: string;
  message: string;
}

export interface DataQualityReport {
  requestedStart: string;
  requestedEnd: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  coverageComplete: boolean;
  sourceCount: number;
  sampled: boolean;
  hasOtherBucket: boolean;
  staleSources: string[];
  emptyReason: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ChatResult {
  /** Present when the question asked for a report rather than an answer. */
  reportOffer?: { range: string };
  conversationId: string;
  reply: string;
  chartSpec: unknown;
  tableSpec: unknown;
  traceId: string;
  plan: QueryPlan;
  steps: { name: string; input: unknown; rowCount?: number }[];
  model: string;
  fellBackToDefaultPlan: boolean;
  planWarnings: PlanWarning[];
  plannerModel: string | null;
  dataQuality: DataQualityReport;
  requiresClarification: boolean;
}

export interface HealthInfo {
  ai: { provider: string; models: string[] };
}

export interface RawDataPage {
  range: { start: string; end: string; label: string };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filteredTotals: Record<string, number>;
  rows: {
    id: string;
    date: string;
    /** Full timestamp as stored, for checking timezone anchoring. */
    storedAt: string;
    source: string;
    connectorId: string | null;
    entityType: string;
    entityId: string;
    dimensions: Record<string, unknown>;
    metrics: Record<string, number>;
    rawData: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    ingestedAt: string;
  }[];
}

export interface DataCatalog {
  coverage: { earliest: string | null; latest: string | null; rowsBySource: Record<string, number>; totalRows: number };
  connectors: {
    id: string;
    type: string;
    displayName: string;
    status: string;
    lastSyncedAt: string | null;
    lastRowCount: number | null;
    coverageStart: string | null;
    coverageEnd: string | null;
    lastError: string | null;
    caveats: string[];
  }[];
  metrics: { key: string; sources: string[]; observedMin: number; observedMax: number; ambiguousAcrossSources: boolean }[];
  dimensions: { key: string; sources: string[] }[];
  customMetrics: { name: string; formula: string }[];
}

export interface SourceBlock {
  source: string;
  connectorId: string | null;
  displayName: string;
  totals: Record<string, number>;
  deltas: Record<string, number | null>;
  timeseries: { date: string; [key: string]: number | string }[];
  entities: { entityId: string; label: string; metrics: Record<string, number> }[];
  rowCount: number;
}

export interface DashboardSummary {
  dateRangeLabel: string;
  range: { start: string; end: string };
  priorRange: { start: string; end: string };
  sources: SourceBlock[];
  blended: { totals: Record<string, number>; deltas: Record<string, number | null>; additiveMetrics: string[] };
  connectors: {
    id: string;
    type: string;
    displayName: string;
    status: string;
    lastSyncedAt: string | null;
    lastRowCount: number | null;
    coverage: { start: string; end: string } | null;
    lastError: string | null;
  }[];
  dataQuality: {
    coverageWarnings: string[];
    contestedMetrics: { metric: string; sources: string[] }[];
    totalRows: number;
  };
  customMetrics: { name: string; formula: string }[];
  breachedAlerts: { rule: { metricKey: string }; currentValue: number; pctChange: number | null }[];
  connectorCount: number;
}

export const DATE_RANGES = [
  { value: 'all_time', label: 'All available data' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_14_days', label: 'Last 14 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
] as const;

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  messageCount: number;
  /** An answer is still being written server-side right now. */
  generating?: boolean;
  /** The question being answered, so a reattached UI isn't blank. */
  pendingPrompt?: string | null;
}

export interface StoredMessage {
  id: string;
  role: string;
  content: string;
  chartSpec: unknown;
  traceId: string | null;
  createdAt: string;
}

export interface TraceDetail {
  traceId: string;
  model: string | null;
  toolCalls: { name: string; input: unknown; rowCount?: number }[];
  tokens: { input: number | null; output: number | null };
  createdAt: string;
  date_range: string;
  row_count: number;
  rows: {
    date: string;
    source: string;
    entityType: string;
    entityId: string;
    dimensions: Record<string, unknown>;
    metrics: Record<string, number>;
  }[];
}

export interface ScheduledReport {
  id: string;
  name: string;
  cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  recipients: string[];
  days: number;
  lastRunAt: string | null;
  lastError: string | null;
  active: boolean;
}

export interface NotificationItem {
  id: string;
  alertRuleId: string;
  breachKey: string;
  detail: { summary?: string } | null;
  createdAt: string;
}

export interface CustomMetric {
  id: string;
  name: string;
  formula: string;
}

export interface AlertRule {
  id: string;
  metricKey: string;
  comparator: 'PCT_CHANGE_GT' | 'PCT_CHANGE_LT' | 'VALUE_GT' | 'VALUE_LT';
  threshold: number;
  windowDays: number;
}

export interface Member {
  userId: string;
  email: string;
  name?: string | null;
  role: string;
  scopedConnectorIds: string[];
  approvedQuestions: string[];
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  link?: string;
  emailSent?: boolean;
  createdAt: string;
}

export interface BillingInfo {
  plan: 'FREE' | 'PRO' | 'TEAM';
  balance: number;
  cap: number;
  stripeConfigured: boolean;
  planOptions: Record<string, number>;
  usageByUser: { userId: string; creditsUsed: number }[];
}


export interface WorkspaceHealth {
  connectors: {
    id: string; displayName: string; type: string; status: string;
    lastSyncedAt: string | null; lastRowCount: number | null;
    coverageStart: string | null; coverageEnd: string | null;
    lastError: string | null; staleHours: number | null; healthy: boolean;
  }[];
  storage: { metricRows: number; conversations: number; messages: number; traces: number };
  usage: {
    creditsUsed: number; creditsRemaining: number;
    queriesLast7Days: number; queriesLast30Days: number;
    topUsers: { userId: string; email: string; queries: number; creditsUsed: number }[];
    modelBreakdown: { model: string; queries: number; avgInputTokens: number; avgOutputTokens: number }[];
  };
  models: {
    health: { id: string; available: boolean; cooldownSecondsRemaining: number; consecutiveFailures: number; successes: number; failures: number; lastLatencyMs: number | null; lastError: string | null }[];
    catalogue: { id: string; label: string; free: boolean; strength: string; structured: boolean; reasoning: boolean; configured: boolean; available: boolean }[];
  };
  issues: { severity: 'error' | 'warning' | 'info'; message: string; action?: string }[];
}

export interface AuditPage {
  page: number; pageSize: number; total: number; totalPages: number;
  actions: { action: string; count: number }[];
  entries: Record<string, unknown>[];
}

export interface ModelOption {
  id: string; label: string; free: boolean; strength: string;
  structured: boolean; reasoning: boolean; configured: boolean; available: boolean;
}

export interface CatalogField {
  id: string;
  kind: 'DIMENSION' | 'METRIC';
  apiName: string;
  uiName: string;
  description: string | null;
  category: string | null;
  custom: boolean;
  syncEnabled: boolean;
  deprecated: boolean;
}

export interface FieldCatalog {
  connectors: {
    connectorId: string;
    displayName: string;
    type: string;
    schemaSyncedAt: string | null;
    schemaError: string | null;
    counts: { total: number; dimensions: number; metrics: number; custom: number; enabled: number };
    categories: { category: string; fields: CatalogField[] }[];
  }[];
  totals: { fields: number; dimensions: number; metrics: number; custom: number; enabled: number };
  populatedKeys: string[];
}

export interface ReconciliationReport {
  connectorId: string;
  displayName: string;
  range: { start: string; end: string };
  checkedAt: string;
  metrics: {
    metric: string; stored: number; reported: number;
    difference: number; percentDifference: number | null;
    status: 'match' | 'minor' | 'mismatch' | 'missing';
  }[];
  summary: { matched: number; minor: number; mismatched: number; missing: number };
  notes: string[];
}

export const api = {
  health: () => request<HealthInfo>('/health'),
  signup: (email: string, password: string, name?: string) =>
    request<AuthResult>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),

  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  listPersonas: () =>
    request<{ personas: { id: string; label: string; blurb: string; defaultMetrics: string[] }[] }>('/personas'),
  setPersona: (persona: string, focusMetrics: string[]) =>
    request('/auth/persona', { method: 'PUT', body: JSON.stringify({ persona, focusMetrics }) }),

  me: () => request<{ id: string; email: string; name?: string }>('/auth/me'),

  listWorkspaces: () => request<WorkspaceSummary[]>('/workspaces'),

  createWorkspace: (name: string) =>
    request<{ id: string; name: string }>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),

  listConnectors: (workspaceId: string) => request<ConnectorSummary[]>(`/workspaces/${workspaceId}/connectors`),

  createConnector: (workspaceId: string, type: string, displayName: string, credentials: Record<string, string> = {}) =>
    request(`/workspaces/${workspaceId}/connectors`, {
      method: 'POST',
      body: JSON.stringify({ type, displayName, credentials }),
    }),

  syncConnector: (workspaceId: string, connectorId: string, range?: { start_date?: string; end_date?: string; all_available?: boolean }) =>
    request<SyncJob>(`/workspaces/${workspaceId}/connectors/${connectorId}/sync`, {
      method: 'POST',
      body: JSON.stringify(range ?? {}),
    }),

  getSyncJob: (workspaceId: string, connectorId: string, jobId: string) =>
    request<SyncJob>(`/workspaces/${workspaceId}/connectors/${connectorId}/sync/${jobId}`),

  deleteConnector: (workspaceId: string, connectorId: string) =>
    request(`/workspaces/${workspaceId}/connectors/${connectorId}`, { method: 'DELETE' }),

  sendChatMessage: (workspaceId: string, message: string, conversationId?: string) =>
    request<ChatResult>(`/workspaces/${workspaceId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, conversationId }),
    }),

  getDashboard: (workspaceId: string, range = 'last_30_days') =>
    request<DashboardSummary>(`/workspaces/${workspaceId}/dashboard?range=${range}`),

  listConversations: (workspaceId: string) =>
    request<ConversationSummary[]>(`/workspaces/${workspaceId}/conversations`),
  getConversation: (workspaceId: string, conversationId: string) =>
    request<{ id: string; title: string | null; messages: StoredMessage[]; generating?: boolean; pendingPrompt?: string | null }>(
      `/workspaces/${workspaceId}/conversations/${conversationId}`
    ),
  deleteConversation: (workspaceId: string, conversationId: string) =>
    request(`/workspaces/${workspaceId}/conversations/${conversationId}`, { method: 'DELETE' }),

  getRawData: (workspaceId: string, params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<RawDataPage>(`/workspaces/${workspaceId}/data/raw?${query.toString()}`);
  },
  reconcileConnector: (workspaceId: string, connectorId: string, days = 7) =>
    request<ReconciliationReport>(`/workspaces/${workspaceId}/connectors/${connectorId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),

  getFieldCatalog: (workspaceId: string, params: Record<string, string | undefined> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    return request<FieldCatalog>(`/workspaces/${workspaceId}/fields?${query.toString()}`);
  },
  refreshFieldCatalog: (workspaceId: string, connectorId?: string) =>
    request<{ results: { connectorId: string; displayName?: string; discovered?: number; custom?: number; error?: string }[] }>(
      `/workspaces/${workspaceId}/fields/refresh`,
      { method: 'POST', body: JSON.stringify({ connectorId }) }
    ),
  setFieldsEnabled: (workspaceId: string, fieldIds: string[], enabled: boolean) =>
    request<{ updated: number }>(`/workspaces/${workspaceId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({ fieldIds, enabled }),
    }),

  getDataCatalog: (workspaceId: string) => request<DataCatalog>(`/workspaces/${workspaceId}/data/catalog`),

  getTrace: (workspaceId: string, traceId: string) =>
    request<TraceDetail>(`/workspaces/${workspaceId}/traces/${traceId}`),

  listReports: (workspaceId: string) => request<ScheduledReport[]>(`/workspaces/${workspaceId}/reports`),
  createReport: (workspaceId: string, report: { name: string; cadence: string; recipients: string[]; days: number }) =>
    request<ScheduledReport>(`/workspaces/${workspaceId}/reports`, { method: 'POST', body: JSON.stringify(report) }),
  deleteReport: (workspaceId: string, reportId: string) =>
    request(`/workspaces/${workspaceId}/reports/${reportId}`, { method: 'DELETE' }),
  runDueReports: (workspaceId: string) =>
    request<{ delivered: number }>(`/workspaces/${workspaceId}/reports/run-due`, { method: 'POST' }),

  listNotifications: (workspaceId: string) =>
    request<NotificationItem[]>(`/workspaces/${workspaceId}/notifications`),
  checkNotifications: (workspaceId: string) =>
    request<{ sent: string[] }>(`/workspaces/${workspaceId}/notifications/check`, { method: 'POST' }),
  setSlackWebhook: (workspaceId: string, slackWebhookUrl: string | null) =>
    request(`/workspaces/${workspaceId}/notifications/slack`, {
      method: 'PUT',
      body: JSON.stringify({ slackWebhookUrl }),
    }),

  updateMemberAccess: (
    workspaceId: string,
    userId: string,
    patch: { role?: string; scopedConnectorIds?: string[]; approvedQuestions?: string[] }
  ) => request(`/workspaces/${workspaceId}/admin/members/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listCustomMetrics: (workspaceId: string) => request<CustomMetric[]>(`/workspaces/${workspaceId}/metrics`),
  createCustomMetric: (workspaceId: string, name: string, formula: string) =>
    request<CustomMetric>(`/workspaces/${workspaceId}/metrics`, { method: 'POST', body: JSON.stringify({ name, formula }) }),
  deleteCustomMetric: (workspaceId: string, id: string) =>
    request(`/workspaces/${workspaceId}/metrics/${id}`, { method: 'DELETE' }),

  listAlertRules: (workspaceId: string) => request<AlertRule[]>(`/workspaces/${workspaceId}/alerts`),
  createAlertRule: (workspaceId: string, rule: Omit<AlertRule, 'id'>) =>
    request<AlertRule>(`/workspaces/${workspaceId}/alerts`, { method: 'POST', body: JSON.stringify(rule) }),
  deleteAlertRule: (workspaceId: string, id: string) =>
    request(`/workspaces/${workspaceId}/alerts/${id}`, { method: 'DELETE' }),

  getWorkspaceHealth: (workspaceId: string) =>
    request<WorkspaceHealth>(`/workspaces/${workspaceId}/admin/health`),

  listModels: (workspaceId: string) =>
    request<{ models: ModelOption[]; health: WorkspaceHealth['models']['health'] }>(`/workspaces/${workspaceId}/models`),

  listMembers: (workspaceId: string) => request<Member[]>(`/workspaces/${workspaceId}/admin/members`),
  updateMemberRole: (workspaceId: string, userId: string, role: string) =>
    request(`/workspaces/${workspaceId}/admin/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (workspaceId: string, userId: string) =>
    request(`/workspaces/${workspaceId}/admin/members/${userId}`, { method: 'DELETE' }),
  listInvites: (workspaceId: string) => request<Invite[]>(`/workspaces/${workspaceId}/admin/invites`),
  createInvite: (workspaceId: string, email: string, role: string) =>
    request<Invite>(`/workspaces/${workspaceId}/admin/invites`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  revokeInvite: (workspaceId: string, inviteId: string) =>
    request(`/workspaces/${workspaceId}/admin/invites/${inviteId}`, { method: 'DELETE' }),
  getAuditLog: (workspaceId: string, params: Record<string, string | number | undefined> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<AuditPage>(`/workspaces/${workspaceId}/admin/audit?${query.toString()}`);
  },

  getInvite: (token: string) => request<{ email: string; role: string; workspaceName: string }>(`/invites/${token}`),
  acceptInvite: (token: string) => request<{ workspaceId: string }>(`/invites/${token}/accept`, { method: 'POST' }),

  getBilling: (workspaceId: string) => request<BillingInfo>(`/workspaces/${workspaceId}/billing`),
  createCheckout: (workspaceId: string, plan: 'PRO' | 'TEAM') =>
    request<{ url: string }>(`/workspaces/${workspaceId}/billing/checkout`, { method: 'POST', body: JSON.stringify({ plan }) }),
  grantCredits: (workspaceId: string, amount: number, reason?: string) =>
    request<{ balance: number }>(`/workspaces/${workspaceId}/billing/grant`, { method: 'POST', body: JSON.stringify({ amount, reason }) }),
};

/**
 * Streams a chat reply token-by-token from POST /chat/stream. The backend
 * writes SSE-style `data: {...}\n\n` frames over a plain fetch response
 * (not EventSource, which only supports GET) — this reads the body as a
 * stream and parses those frames as they arrive.
 */
export async function streamChatMessage(
  workspaceId: string,
  message: string,
  conversationId: string | undefined,
  model: string | undefined,
  handlers: {
    onToken: (token: string) => void;
    /** Progress updates: which step the backend is on right now. */
    onStage?: (stage: { stage: string; detail?: string; elapsedMs?: number; step?: number; totalSteps?: number }) => void;
    onDone: (result: ChatResult) => void;
    onError: (message: string) => void;
  }
) {
  const token = getToken();
  try {
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, conversationId, model }),
    });

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      handlers.onError(body?.error?.toString?.() ?? `Request failed with status ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = JSON.parse(line.slice('data: '.length));

        if (payload.error) handlers.onError(payload.error);
        else if (payload.done) handlers.onDone(payload as ChatResult);
        else if (typeof payload.token === 'string') handlers.onToken(payload.token);
        else if (typeof payload.stage === 'string') handlers.onStage?.(payload);
      }
    }
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : 'Connection to the assistant was interrupted.');
  }
}

/**
 * Downloads a PDF report. Separate from `request` because it returns a
 * binary body rather than JSON, and triggers a browser download.
 */
export async function downloadReport(
  workspaceId: string,
  days = 30,
  options: { range?: string; sections?: Record<string, boolean>; tableRows?: number } = {},
) {
  const token = getToken();
  const query = new URLSearchParams();
  if (options.range) query.set('range', options.range);
  else query.set('days', String(days));
  for (const [key, value] of Object.entries(options.sections ?? {})) query.set(key, String(value));
  if (options.tableRows) query.set('tableRows', String(options.tableRows));

  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/reports/download?${query.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.toString?.() ?? 'Could not generate the report');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `prism-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Downloads the current raw-data filter as CSV. */
export async function downloadRawCsv(workspaceId: string, params: Record<string, string | undefined>) {
  const token = getToken();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }

  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/data/export.csv?${query.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.toString?.() ?? 'Could not export the data');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `prism-data-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
