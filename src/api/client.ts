import {
  Actor,
  AnnotationDetail,
  AnnotationSummary,
  ApiError,
  ApiErrorEnvelope,
  CapabilitiesResponse,
  CollectionSource,
  ContentListResponse,
  ContentThreadResponse,
  ExportJsonResult,
  ListQuery,
  MachineKeyDto,
  MachineScope,
  Project,
  ProjectInput,
  ProjectOverviewResponse,
  ProviderBudget,
  PublicContent,
  PullProviderName,
  SavedQueryDto,
  SourceInput,
  SourceJob,
} from '../contracts/api';
import { mockEngine } from './mockEngine';

export type ApiMode = 'demo' | 'live';

const STORAGE_MODE_KEY = 'siftline.apiMode';

let currentMode: ApiMode = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_MODE_KEY);
    return stored === 'live' ? 'live' : 'demo';
  } catch {
    return 'demo';
  }
})();

const listeners = new Set<() => void>();

export function getApiMode(): ApiMode {
  return currentMode;
}

export function setApiMode(mode: ApiMode) {
  currentMode = mode;
  try {
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  } catch {
    // ignore storage errors
  }
  listeners.forEach((fn) => fn());
}

export function subscribeApiMode(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function buildQueryParams(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && String(item) !== '') {
          sp.append(k, String(item));
        }
      }
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function liveFetch<T>(
  path: string,
  options: RequestInit & { rawBase?: boolean } = {},
): Promise<T> {
  const url = options.rawBase ? path : `/api/v1${path}`;
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (!res.ok) {
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    let envelope: ApiErrorEnvelope['error'] = {
      code: `http_${res.status}`,
      message: res.statusText || `HTTP ${res.status}`,
      requestId: 'none',
      retryable: res.status === 503,
    };
    try {
      const json = (await res.json()) as Partial<ApiErrorEnvelope>;
      if (json && json.error) {
        envelope = {
          code: json.error.code || envelope.code,
          message: json.error.message || envelope.message,
          requestId: json.error.requestId || envelope.requestId,
          retryable: Boolean(json.error.retryable),
        };
      }
    } catch {
      // non-JSON response
    }
    throw new ApiError(res.status, envelope, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }

  return (await res.json()) as T;
}

export const apiClient = {
  async healthz(): Promise<{ ok: boolean }> {
    if (currentMode === 'demo') return mockEngine.healthz();
    return liveFetch('/healthz', { rawBase: true });
  },

  async readyz(): Promise<{ ok: boolean }> {
    if (currentMode === 'demo') return mockEngine.healthz();
    return liveFetch('/readyz', { rawBase: true });
  },

  async getSession(): Promise<{ user: Actor | null }> {
    if (currentMode === 'demo') return mockEngine.getSession();
    return liveFetch('/auth/session');
  },

  async login(email: string, password: string): Promise<{ user: Actor }> {
    if (currentMode === 'demo') return mockEngine.login(email, password);
    return liveFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async register(email: string, password: string, invite: string): Promise<{ registered: boolean }> {
    if (currentMode === 'demo') return mockEngine.register(email, password, invite);
    return liveFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, invite }),
    });
  },

  async logout(): Promise<{ loggedOut: boolean }> {
    if (currentMode === 'demo') return mockEngine.logout();
    return liveFetch('/auth/logout', { method: 'POST' });
  },

  async getCapabilities(): Promise<CapabilitiesResponse> {
    if (currentMode === 'demo') return mockEngine.getCapabilities();
    return liveFetch('/capabilities');
  },

  async getOpenApiSummary(): Promise<Record<string, unknown>> {
    if (currentMode === 'demo') {
      return {
        openapi: '3.0.3',
        info: { title: 'Reddit Monitoring MVP API', version: 'prod@dd2feb2' },
        pathsCount: 31,
        securitySchemes: { cookieAuth: 'app_session', bearerAuth: 'Machine API Key (43-char)' },
      };
    }
    return liveFetch('/openapi.json');
  },

  async getProjects(): Promise<{ projects: Project[] }> {
    if (currentMode === 'demo') return mockEngine.getProjects();
    return liveFetch('/projects');
  },

  async getProject(id: string): Promise<Project> {
    if (currentMode === 'demo') return mockEngine.getProject(id);
    return liveFetch(`/projects/${id}`);
  },

  async createProject(input: ProjectInput): Promise<Project> {
    if (currentMode === 'demo') return mockEngine.createProject(input);
    return liveFetch('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateProject(id: string, input: ProjectInput & { revision: number }): Promise<Project> {
    if (currentMode === 'demo') return mockEngine.updateProject(id, input);
    return liveFetch(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteProject(id: string, revision: number): Promise<{ deleted: boolean }> {
    if (currentMode === 'demo') return mockEngine.deleteProject(id, revision);
    return liveFetch(`/projects/${id}?revision=${encodeURIComponent(revision)}`, {
      method: 'DELETE',
    });
  },

  async getProjectOverview(id: string): Promise<ProjectOverviewResponse> {
    if (currentMode === 'demo') return mockEngine.getProjectOverview(id);
    return liveFetch(`/projects/${id}/overview`);
  },

  async listContent(query: ListQuery, pathProjectId?: string): Promise<ContentListResponse> {
    if (currentMode === 'demo') return mockEngine.listContent(query, pathProjectId);
    const { projectId, ...rest } = query;
    if (pathProjectId) {
      const qs = buildQueryParams(rest as Record<string, unknown>);
      return liveFetch(`/projects/${pathProjectId}/content${qs}`);
    }
    const qs = buildQueryParams({ projectId, ...rest } as Record<string, unknown>);
    return liveFetch(`/content${qs}`);
  },

  async getContentDetail(id: string): Promise<{ content: PublicContent }> {
    if (currentMode === 'demo') return mockEngine.getContentDetail(id);
    return liveFetch(`/content/${id}`);
  },

  async getContentThread(
    id: string,
    query: ListQuery & { view?: 'top' | 'matches' | 'op' },
  ): Promise<ContentThreadResponse> {
    if (currentMode === 'demo') return mockEngine.getContentThread(id, query);
    const qs = buildQueryParams(query as Record<string, unknown>);
    return liveFetch(`/content/${id}/thread${qs}`);
  },

  async hydrateProject(
    projectId: string,
    payload: { contentIds: string[]; maxCommentsPerPost: number },
    idempotencyKey: string,
  ): Promise<{ jobIds: string[] }> {
    if (currentMode === 'demo') return mockEngine.hydrateProject(projectId, payload, idempotencyKey);
    return liveFetch(`/projects/${projectId}/hydrate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  async exportContent(
    params: ListQuery & { format?: 'json' | 'csv'; maxRows?: number },
  ): Promise<{ format: 'json' | 'csv'; filename: string; text: string; jsonResult?: ExportJsonResult }> {
    if (currentMode === 'demo') return mockEngine.exportContent(params);
    const qs = buildQueryParams(params as Record<string, unknown>);
    const res = await fetch(`/api/v1/content/export${qs}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const retryAfter = res.headers.get('Retry-After');
      let errMsg = `Export failed (${res.status})`;
      let code = `http_${res.status}`;
      try {
        const j = (await res.json()) as Partial<ApiErrorEnvelope>;
        if (j?.error) {
          errMsg = j.error.message;
          code = j.error.code;
        }
      } catch {
        // ignore
      }
      throw new ApiError(
        res.status,
        { code, message: errMsg, requestId: 'export', retryable: res.status === 429 || res.status === 503 },
        retryAfter ? Number(retryAfter) : undefined,
      );
    }
    const text = await res.text();
    const format = params.format || 'json';
    if (format === 'json') {
      let jsonResult: ExportJsonResult;
      try {
        jsonResult = JSON.parse(text) as ExportJsonResult;
      } catch {
        throw new ApiError(502, {
          code: 'incomplete_stream',
          message: 'Export stream terminated before valid JSON completed.',
          requestId: 'export',
          retryable: true,
        });
      }
      if (!jsonResult?.result || jsonResult.result.complete !== true) {
        throw new ApiError(502, {
          code: 'incomplete_stream',
          message: 'Export stream did not return result.complete === true.',
          requestId: 'export',
          retryable: true,
        });
      }
      return { format: 'json', filename: 'content.json', text, jsonResult };
    }
    return { format: 'csv', filename: 'content.csv', text };
  },

  async getSources(): Promise<{ sources: CollectionSource[]; capabilities: CapabilitiesResponse['providers'] }> {
    if (currentMode === 'demo') return mockEngine.getSources();
    return liveFetch('/sources');
  },

  async createSource(input: SourceInput): Promise<{ source: CollectionSource }> {
    if (currentMode === 'demo') return mockEngine.createSource(input);
    return liveFetch('/sources', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateSource(
    id: string,
    input: { fallbackProvider?: 'scrapebadger' | 'red_crawler' | null; state?: CollectionSource['state']; revision: number },
  ): Promise<{ updated: boolean }> {
    if (currentMode === 'demo') return mockEngine.updateSource(id, input);
    return liveFetch(`/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async collectSource(
    id: string,
    payload: {
      from: string;
      to: string;
      limit: number;
      includeComments?: boolean;
      useFallback?: boolean;
      maxCommentsPerPost?: number;
    },
    idempotencyKey: string,
  ): Promise<{ jobId: string }> {
    if (currentMode === 'demo') return mockEngine.collectSource(id, payload, idempotencyKey);
    return liveFetch(`/sources/${id}/collect`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  async refreshSource(id: string, payload: { contentIds: string[] }, idempotencyKey: string): Promise<{ jobId: string }> {
    if (currentMode === 'demo') return mockEngine.refreshSource(id, payload, idempotencyKey);
    return liveFetch(`/sources/${id}/refresh`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  async ingestSource(
    id: string,
    rawJson: string,
    idempotencyKey: string,
  ): Promise<{ jobId: string; added: number; updated: number; accepted: number }> {
    if (currentMode === 'demo') return mockEngine.ingestSource(id, rawJson, idempotencyKey);
    return liveFetch(`/sources/${id}/ingest`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' },
      body: rawJson,
    });
  },

  async getSourceJobs(sourceId: string): Promise<{ jobs: SourceJob[] }> {
    if (currentMode === 'demo') return mockEngine.getSourceJobs(sourceId);
    return liveFetch(`/sources/${sourceId}/jobs`);
  },

  async getJobsByIds(ids: string[]): Promise<{ jobs: SourceJob[] }> {
    if (currentMode === 'demo') return mockEngine.getJobsByIds(ids);
    return liveFetch(`/source-jobs?ids=${encodeURIComponent(ids.join(','))}`);
  },

  async getJobDetail(jobId: string): Promise<{ job: SourceJob }> {
    if (currentMode === 'demo') return mockEngine.getJobDetail(jobId);
    return liveFetch(`/source-jobs/${jobId}`);
  },

  async jobAction(
    jobId: string,
    action: 'cancel' | 'retry' | 'continue',
    acknowledgePotentialCharge?: boolean,
  ): Promise<{ job: SourceJob }> {
    if (currentMode === 'demo') return mockEngine.jobAction(jobId, action, acknowledgePotentialCharge);
    return liveFetch(`/source-jobs/${jobId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgePotentialCharge }),
    });
  },

  async unblockSource(sourceId: string, acknowledgePotentialCharge: boolean): Promise<{ unblocked: boolean }> {
    if (currentMode === 'demo') return mockEngine.unblockSource(sourceId, acknowledgePotentialCharge);
    return liveFetch(`/sources/${sourceId}/unblock`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgePotentialCharge }),
    });
  },

  async getBudgets(): Promise<{ budgets: ProviderBudget[] }> {
    if (currentMode === 'demo') return mockEngine.getBudgets();
    return liveFetch('/sources/budgets');
  },

  async updateBudget(
    provider: PullProviderName,
    payload: {
      enabled: boolean;
      dailyRequests: number;
      monthlyRequests: number;
      dailyResources: number;
      monthlyResources: number;
      minimumIntervalMs: number;
      revision: number;
    },
  ): Promise<{ revision: number }> {
    if (currentMode === 'demo') return mockEngine.updateBudget(provider, payload);
    return liveFetch(`/sources/budgets/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getSavedQueries(): Promise<{ queries: SavedQueryDto[] }> {
    if (currentMode === 'demo') return mockEngine.getSavedQueries();
    return liveFetch('/workspace/queries');
  },

  async createSavedQuery(payload: { name: string; filter: ListQuery }): Promise<{ id: string }> {
    if (currentMode === 'demo') return mockEngine.createSavedQuery(payload);
    return liveFetch('/workspace/queries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteSavedQuery(id: string): Promise<{ deleted: boolean }> {
    if (currentMode === 'demo') return mockEngine.deleteSavedQuery(id);
    return liveFetch(`/workspace/queries/${id}`, { method: 'DELETE' });
  },

  async getAnnotations(): Promise<{ annotations: AnnotationSummary[] }> {
    if (currentMode === 'demo') return mockEngine.getAnnotations();
    return liveFetch('/workspace/annotations');
  },

  async getAnnotation(contentId: string): Promise<{ annotation: AnnotationDetail | null }> {
    if (currentMode === 'demo') return mockEngine.getAnnotation(contentId);
    return liveFetch(`/workspace/annotations/${contentId}`);
  },

  async putAnnotation(
    contentId: string,
    payload: { favorite: boolean; note: string; revision: number },
  ): Promise<{ revision: number }> {
    if (currentMode === 'demo') return mockEngine.putAnnotation(contentId, payload);
    return liveFetch(`/workspace/annotations/${contentId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async createInvite(role: 'viewer' | 'admin'): Promise<{ code: string }> {
    if (currentMode === 'demo') return mockEngine.createInvite(role);
    return liveFetch('/access/invites', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  },

  async getMachineKeys(): Promise<{ keys: MachineKeyDto[] }> {
    if (currentMode === 'demo') return mockEngine.getMachineKeys();
    return liveFetch('/access/keys');
  },

  async createMachineKey(payload: {
    label: string;
    scopes: MachineScope[];
    allowedSourceIds: string[];
    expiresInDays: number;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    if (currentMode === 'demo') return mockEngine.createMachineKey(payload);
    return liveFetch('/access/keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async revokeMachineKey(id: string): Promise<{ revoked: boolean }> {
    if (currentMode === 'demo') return mockEngine.revokeMachineKey(id);
    return liveFetch(`/access/keys/${id}`, { method: 'DELETE' });
  },
};
