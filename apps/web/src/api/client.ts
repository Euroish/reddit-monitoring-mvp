import {
  type Actor,
  type AnnotationDetail,
  type AnnotationSummary,
  ApiError,
  type ApiErrorEnvelope,
  type CapabilitiesResponse,
  type CollectionSource,
  type ContentListResponse,
  type ContentThreadResponse,
  type ExportJsonResult,
  type ListQuery,
  type MachineKeyDto,
  type MachineScope,
  type Project,
  type ProjectInput,
  type ProjectOverviewResponse,
  type ProviderBudget,
  type PublicContent,
  type PullProviderName,
  type SavedQueryDto,
  type SourceInput,
  type SourceJob,
  mergeServerCapabilities,
  normalizeCollectionSource,
  normalizeSourceJob,
} from '../contracts/api';

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
    return liveFetch('/healthz', { rawBase: true });
  },

  async readyz(): Promise<{ ok: boolean }> {
    return liveFetch('/readyz', { rawBase: true });
  },

  async getSession(): Promise<{ user: Actor | null }> {
    return liveFetch('/auth/session');
  },

  async login(email: string, password: string): Promise<{ user: Actor }> {
    return liveFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async register(email: string, password: string, invite: string): Promise<{ registered: boolean }> {
    return liveFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, invite }),
    });
  },

  async logout(): Promise<{ loggedOut: boolean }> {
    return liveFetch('/auth/logout', { method: 'POST' });
  },

  async getCapabilities(): Promise<CapabilitiesResponse> {
    const raw = await liveFetch<Record<string, unknown>>('/capabilities');
    return {
      ...(raw as unknown as CapabilitiesResponse),
      providers: mergeServerCapabilities(raw.providers),
    };
  },

  async getOpenApiSummary(): Promise<Record<string, unknown>> {
    return liveFetch('/openapi.json');
  },

  async getProjects(): Promise<{ projects: Project[] }> {
    return liveFetch('/projects');
  },

  async getProject(id: string): Promise<Project> {
    return liveFetch(`/projects/${id}`);
  },

  async createProject(input: ProjectInput): Promise<Project> {
    return liveFetch('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateProject(id: string, input: ProjectInput & { revision: number }): Promise<Project> {
    return liveFetch(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteProject(id: string, revision: number): Promise<{ deleted: boolean }> {
    return liveFetch(`/projects/${id}?revision=${encodeURIComponent(revision)}`, {
      method: 'DELETE',
    });
  },

  async getProjectOverview(id: string): Promise<ProjectOverviewResponse> {
    return liveFetch(`/projects/${id}/overview`);
  },

  async listContent(query: ListQuery, pathProjectId?: string): Promise<ContentListResponse> {
    const { projectId, ...rest } = query;
    if (pathProjectId) {
      const qs = buildQueryParams(rest as Record<string, unknown>);
      return liveFetch(`/projects/${pathProjectId}/content${qs}`);
    }
    const qs = buildQueryParams({ projectId, ...rest } as Record<string, unknown>);
    return liveFetch(`/content${qs}`);
  },

  async getContentDetail(id: string): Promise<{ content: PublicContent }> {
    return liveFetch(`/content/${id}`);
  },

  async getContentThread(
    id: string,
    query: ListQuery & { view?: 'top' | 'matches' | 'op' },
  ): Promise<ContentThreadResponse> {
    const cleanQuery: Record<string, unknown> = { ...query };
    delete cleanQuery.limit;
    delete cleanQuery.cursor;
    const qs = buildQueryParams(cleanQuery);
    return liveFetch(`/content/${id}/thread${qs}`);
  },

  async hydrateProject(
    projectId: string,
    payload: { contentIds: string[]; maxCommentsPerPost: number },
    idempotencyKey: string,
  ): Promise<{ jobIds: string[] }> {
    return liveFetch(`/projects/${projectId}/hydrate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  async exportContent(
    params: ListQuery & { format?: 'json' | 'csv'; maxRows?: number },
  ): Promise<{ format: 'json' | 'csv'; filename: string; text: string; jsonResult?: ExportJsonResult }> {
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
    const res = await liveFetch<{ sources: Array<Record<string, unknown>>; capabilities: unknown }>('/sources');
    return {
      sources: (res.sources || []).map(normalizeCollectionSource),
      capabilities: mergeServerCapabilities(res.capabilities),
    };
  },

  async createSource(input: SourceInput): Promise<{ source: CollectionSource }> {
    const res = await liveFetch<{ source: Record<string, unknown> }>('/sources', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { source: normalizeCollectionSource(res.source) };
  },

  async updateSource(
    id: string,
    input: { fallbackProvider?: 'scrapebadger' | 'red_crawler' | null; state?: CollectionSource['state']; revision: number },
  ): Promise<{ updated: boolean }> {
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
    return liveFetch(`/sources/${id}/collect`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  async refreshSource(id: string, payload: { contentIds: string[] }, idempotencyKey: string): Promise<{ jobId: string }> {
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
    return liveFetch(`/sources/${id}/ingest`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' },
      body: rawJson,
    });
  },

  async getSourceJobs(sourceId: string): Promise<{ jobs: SourceJob[] }> {
    const res = await liveFetch<{ jobs: Array<Record<string, unknown>> }>(`/sources/${sourceId}/jobs`);
    return { jobs: (res.jobs || []).map(normalizeSourceJob) };
  },

  async getJobsByIds(ids: string[]): Promise<{ jobs: SourceJob[] }> {
    const res = await liveFetch<{ jobs: Array<Record<string, unknown>> }>(`/source-jobs?ids=${encodeURIComponent(ids.join(','))}`);
    return { jobs: (res.jobs || []).map(normalizeSourceJob) };
  },

  async getJobDetail(jobId: string): Promise<{ job: SourceJob }> {
    const res = await liveFetch<{ job: Record<string, unknown> }>(`/source-jobs/${jobId}`);
    return { job: normalizeSourceJob(res.job) };
  },

  async jobAction(
    jobId: string,
    action: 'cancel' | 'retry' | 'continue',
    acknowledgePotentialCharge?: boolean,
  ): Promise<{ jobId?: string; job?: SourceJob }> {
    return liveFetch(`/source-jobs/${jobId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgePotentialCharge }),
    });
  },

  async unblockSource(sourceId: string, acknowledgePotentialCharge: boolean): Promise<{ unblocked: boolean }> {
    return liveFetch(`/sources/${sourceId}/unblock`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgePotentialCharge }),
    });
  },

  async getBudgets(): Promise<{ budgets: ProviderBudget[] }> {
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
    return liveFetch(`/sources/budgets/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getSavedQueries(): Promise<{ queries: SavedQueryDto[] }> {
    return liveFetch('/workspace/queries');
  },

  async createSavedQuery(payload: { name: string; filter: ListQuery }): Promise<{ id: string }> {
    return liveFetch('/workspace/queries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteSavedQuery(id: string): Promise<{ deleted: boolean }> {
    return liveFetch(`/workspace/queries/${id}`, { method: 'DELETE' });
  },

  async getAnnotations(): Promise<{ annotations: AnnotationSummary[] }> {
    return liveFetch('/workspace/annotations');
  },

  async getAnnotation(contentId: string): Promise<{ annotation: AnnotationDetail | null }> {
    return liveFetch(`/workspace/annotations/${contentId}`);
  },

  async putAnnotation(
    contentId: string,
    payload: { favorite: boolean; note: string; revision: number },
  ): Promise<{ revision: number }> {
    return liveFetch(`/workspace/annotations/${contentId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async createInvite(role: 'viewer' | 'admin'): Promise<{ code: string }> {
    return liveFetch('/access/invites', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  },

  async getMachineKeys(): Promise<{ keys: MachineKeyDto[] }> {
    return liveFetch('/access/keys');
  },

  async createMachineKey(payload: {
    label: string;
    scopes: MachineScope[];
    allowedSourceIds: string[];
    expiresInDays: number;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    return liveFetch('/access/keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async revokeMachineKey(id: string): Promise<{ revoked: boolean }> {
    return liveFetch(`/access/keys/${id}`, { method: 'DELETE' });
  },
};
