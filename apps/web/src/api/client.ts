import type { AccountInviteDto, BrowserSessionDto } from "../../../../packages/contracts/src/source-content";
import {
  type Actor,
  type AnnotationDetail,
  type AnnotationSummary,
  ApiError,
  type ApiErrorEnvelope,
  type AuditEventDto,
  type AuthorDirectoryRowDto,
  type AuthorProfileResponseDto,
  type CapabilitiesResponse,
  type CommunityDeepDiveResponseDto,
  type CommunityMatrixRowDto,
  type FeedAdminSummaryDto,
  type FeedEventType,
  type FeedHotResponseDto,
  type FeedMode,
  type FeedPreferencesDto,
  type FeedStreamResponseDto,
  type IntelligenceOpsSummaryDto,
  type MonitorOverviewResponseDto,
  type MonitorPostsResponseDto,
  type Platform,
  type CollectionSource,
  type ContentFacets,
  type ContentFacetsQuery,
  type ContentListResponse,
  type ContentThreadResponse,
  type CredentialProviderName,
  type DocDetail,
  type DocInput,
  type DocPatch,
  type DocSummary,
  type ExportJsonResult,
  type ListQuery,
  type MachineKeyDto,
  type MachineScope,
  type PlanPolicyDto,
  type PlanTier,
  type Project,
  type ProjectInput,
  type ProjectOverviewResponse,
  type ProviderBudget,
  type ProviderCredentialStatus,
  type PublicContent,
  type PublicSourceDirectory,
  type PullProviderName,
  type QuotaOverrideDto,
  type QuotasSummaryResponse,
  type RecentJobDto,
  type SavedQueryDto,
  type SessionPayload,
  type SourceInput,
  type SourcePatch,
  type SourcePreviewResult,
  type SourceImport,
  type SourceImportResult,
  type SourceJob,
  type StoryFeed,
  type StoryQuery,
  type UserAccountDto,
  normalizeSourceJob,
} from '../contracts/api';

function countCsvDataRows(csvText: string): number {
  let rows = 0;
  let inQuotes = false;
  let hasContent = false;
  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      hasContent = true;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csvText[i + 1] === '\n') i += 1;
      if (hasContent) rows += 1;
      hasContent = false;
    } else {
      hasContent = true;
    }
  }
  if (hasContent) rows += 1;
  return Math.max(0, rows - 1);
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

export async function liveFetch<T>(
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

  async getBrowserSessions(): Promise<{ sessions: BrowserSessionDto[] }> {
    return liveFetch("/auth/sessions");
  },

  async revokeBrowserSession(id: string): Promise<{ revoked: boolean }> {
    return liveFetch("/auth/sessions/" + encodeURIComponent(id), { method: "DELETE" });
  },

  async logoutAll(): Promise<{ loggedOut: boolean }> {
    return liveFetch("/auth/logout-all", { method: "POST" });
  },

  async getSession(): Promise<SessionPayload> {
    return liveFetch('/auth/session');
  },

  startAccountEmail(purpose: 'register' | 'verify' | 'reset', email: string, proof: string, invite?: string) {
    const body = purpose === 'verify' ? { proof } : { email, proof, invite };
    return liveFetch<{ accepted: boolean }>('/auth/email/' + purpose + '/start', { method: 'POST', body: JSON.stringify(body) });
  },

  finishAccountEmail(purpose: 'register' | 'verify' | 'reset', token: string, password: string) {
    const body = purpose === 'verify' ? { token } : { token, password };
    return liveFetch<{ completed: boolean }>('/auth/email/' + purpose + '/finish', { method: 'POST', body: JSON.stringify(body) });
  },

  changeAccountPassword(currentPassword: string, password: string) {
    return liveFetch<{ completed: boolean }>('/auth/password/change', {
      method: 'POST', body: JSON.stringify({ currentPassword, password }),
    });
  },

  async login(email: string, password: string, remember?: boolean): Promise<{ user: Actor } | { mfaRequired: true; challenge: string }> {
    return liveFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
    });
  },

  completeMfa(challenge: string, code: string) {
    return liveFetch<{ user: Actor }>('/auth/mfa/complete', { method: 'POST', body: JSON.stringify({ challenge, code }) });
  },

  stepUpMfa(code: string) {
    return liveFetch<{ verified: boolean }>('/auth/mfa/step-up', { method: 'POST', body: JSON.stringify({ code }) });
  },

  rotateRecoveryCodes() {
    return liveFetch<{ codes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST' });
  },

  async register(
    email: string,
    password: string,
    invite?: string,
  ): Promise<{ registered: boolean; user?: Actor }> {
    const trimmedInvite = invite?.trim();
    const payload = trimmedInvite ? { email, password, invite: trimmedInvite } : { email, password };
    return liveFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async logout(): Promise<{ loggedOut: boolean }> {
    return liveFetch('/auth/logout', { method: 'POST' });
  },

  async getPublicSources(): Promise<PublicSourceDirectory> {
    return liveFetch('/public/sources');
  },

  async getStories(query: StoryQuery = {}): Promise<StoryFeed> {
    const qs = buildQueryParams({ ...query });
    return liveFetch(`/content/stories${qs}`);
  },

  async getContentFacets(query: ContentFacetsQuery): Promise<ContentFacets> {
    const qs = buildQueryParams({ ...query });
    return liveFetch(`/content/facets${qs}`);
  },

  async getCapabilities(): Promise<CapabilitiesResponse> {
    return liveFetch('/capabilities');
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
  ): Promise<{
    format: 'json' | 'csv';
    filename: string;
    text: string;
    exportedCount: number;
    truncated: boolean;
    maybeTruncated: boolean;
    jsonResult?: ExportJsonResult;
  }> {
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
    const maxRows = params.maxRows ?? 10000;
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
      return {
        format: 'json',
        filename: 'content.json',
        text,
        exportedCount: jsonResult.result.exportedCount,
        truncated: jsonResult.result.truncated,
        maybeTruncated: jsonResult.result.truncated,
        jsonResult,
      };
    }
    const exportedCount = countCsvDataRows(text);
    const maybeTruncated = exportedCount >= maxRows;
    return { format: 'csv', filename: 'content.csv', text, exportedCount, truncated: false, maybeTruncated };
  },

  async getSources(): Promise<{ sources: CollectionSource[]; capabilities: CapabilitiesResponse['providers'] }> {
    return liveFetch('/sources');
  },

  async createSource(input: SourceInput): Promise<{ source: CollectionSource }> {
    return liveFetch('/sources', { method: 'POST', body: JSON.stringify(input) });
  },

  async previewSource(input: SourceInput): Promise<SourcePreviewResult> {
    return liveFetch('/sources/preview', { method: 'POST', body: JSON.stringify(input) });
  },

  async importSources(input: SourceImport): Promise<SourceImportResult> {
    return liveFetch('/sources/import', { method: 'POST', body: JSON.stringify(input) });
  },

  async updateSource(id: string, input: SourcePatch): Promise<{ updated: boolean }> {
    return liveFetch('/sources/' + id, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async batchUpdateSources(payload: {
    ids: string[];
    feedLane?: 'discussion' | 'release' | 'monitor_only' | 'news';
    qualityGrade?: string | null;
    state?: 'active' | 'paused' | 'archived';
    tier?: 'T1' | 'T1_5' | 'T2';
  }): Promise<{ updatedCount: number; ids: string[] }> {
    return liveFetch('/sources/batch-update', {
      method: 'POST',
      body: JSON.stringify(payload),
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
      projectId?: string;
      queryHints?: import('../contracts/api').QueryHintsValue;
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

  async createInvite(role: 'viewer' | 'admin', email?: string): Promise<{ code: string }> {
    return liveFetch('/access/invites', {
      method: 'POST',
      body: JSON.stringify({ role, email }),
    });
  },

  listInvites() {
    return liveFetch<{ invites: AccountInviteDto[] }>('/access/invites');
  },

  revokeInvite(id: string) {
    return liveFetch<{ revoked: boolean }>('/access/invites/' + encodeURIComponent(id), { method: 'DELETE' });
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

  async getProviderCredentials(): Promise<{ networkEnabled: boolean; credentials: ProviderCredentialStatus[] }> {
    return liveFetch('/sources/credentials');
  },

  async saveProviderCredential(
    provider: CredentialProviderName,
    payload: { apiKey: string; revision?: number },
  ): Promise<{ credential: ProviderCredentialStatus; reloaded: boolean }> {
    return liveFetch(`/sources/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async revokeProviderCredential(
    provider: CredentialProviderName,
  ): Promise<{ credential: ProviderCredentialStatus; reloaded: boolean }> {
    return liveFetch(`/sources/credentials/${provider}`, { method: 'DELETE' });
  },

  async testProviderCredential(
    provider: CredentialProviderName,
    confirmPaidProbe: boolean,
  ): Promise<{ ok: boolean; mode: 'dry' | 'live'; status?: number; reason: string; networkEnabled?: boolean }> {
    return liveFetch(`/sources/credentials/${provider}/test`, {
      method: 'POST',
      body: JSON.stringify({ confirmPaidProbe }),
    });
  },

  async getUsers(): Promise<{ users: UserAccountDto[] }> {
    return liveFetch('/access/users');
  },

  async updateUserAccess(
    id: string,
    payload: { role?: 'admin' | 'viewer'; status?: 'active' | 'disabled'; planTier?: PlanTier },
  ): Promise<{ user: UserAccountDto }> {
    return liveFetch(`/access/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async getAccessAudit(): Promise<{ events: AuditEventDto[] }> {
    return liveFetch('/access/audit');
  },

  async getRecentJobs(params: {
    jobId?: string;
    status?: string;
    sourceId?: string;
    projectId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ jobs: RecentJobDto[]; scope: 'all' | 'personal' }> {
    const qs = buildQueryParams(params as Record<string, unknown>);
    return liveFetch(`/source-jobs/recent${qs}`);
  },

  async getBatches(params: {
    forProjectId?: string;
    sourceId?: string;
    jobId?: string;
    limit?: number;
  } = {}): Promise<{ batches: import('../contracts/api').CollectionBatchDto[] }> {
    const qs = buildQueryParams(params as Record<string, unknown>);
    return liveFetch(`/batches${qs}`);
  },

  async getProjectBatches(
    projectId: string,
  ): Promise<{ batches: import('../contracts/api').ProjectBatchDto[] }> {
    return liveFetch(`/projects/${projectId}/batches`);
  },

  async attachProjectBatch(
    projectId: string,
    batchId: string,
  ): Promise<{ attached: boolean; batch: import('../contracts/api').ProjectBatchDto | null }> {
    return liveFetch(`/projects/${projectId}/batches`, {
      method: 'POST',
      body: JSON.stringify({ batchId }),
    });
  },

  async updateProjectBatchStatus(
    projectId: string,
    batchId: string,
    status: 'enabled' | 'disabled' | 'removed',
  ): Promise<{ updated: boolean; batchId: string; status: 'enabled' | 'disabled' | 'removed' }> {
    return liveFetch(`/projects/${projectId}/batches/${batchId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async previewResearchPlan(
    payload: import('../contracts/api').ResearchPlanPreviewRequest,
  ): Promise<import('../contracts/api').ResearchPlanPreviewResponse> {
    return liveFetch('/research/collection-plans/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async collectResearchPlan(
    payload: import('../contracts/api').ResearchPlanCollectRequest,
    idempotencyKey: string,
  ): Promise<{ jobId: string; sourceId: string }> {
    return liveFetch('/research/collection-plans/collect', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  async publishProject(
    projectId: string,
    payload: { visibility: 'private' | 'shared'; revision: number },
  ): Promise<Project> {
    return liveFetch(`/projects/${projectId}/publish`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async forkProject(
    projectId: string,
    payload: { name?: string; description?: string } = {},
  ): Promise<Project> {
    return liveFetch(`/projects/${projectId}/fork`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async moveProjectBatch(
    sourceProjectId: string,
    batchId: string,
    targetProjectId: string,
  ): Promise<{ moved: boolean; batchId: string; sourceProjectId: string; targetProjectId: string }> {
    return liveFetch(`/projects/${sourceProjectId}/batches/${batchId}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetProjectId }),
    });
  },

  async discardBatch(batchId: string): Promise<{ discarded: boolean; id: string }> {
    return liveFetch(`/batches/${batchId}`, { method: 'DELETE' });
  },

  async getGlobalBudget(): Promise<import('../contracts/api').GlobalSocialBudgetDto> {
    return liveFetch('/sources/budgets/global');
  },

  async updateGlobalBudget(payload: {
    dailySocialItemCeiling: number;
    autoHydrationEnabled?: boolean;
    revision: number;
  }): Promise<import('../contracts/api').GlobalSocialBudgetDto> {
    return liveFetch('/sources/budgets/global', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getLegacySources(): Promise<{ items: import('../contracts/api').LegacySourceCandidateDto[] }> {
    return liveFetch('/intelligence/admin/legacy-sources');
  },

  async reconcileLegacySource(
    sourceId: string,
    payload: { action: 'pause_schedule' | 'claim_monitor_managed'; revision: number },
  ): Promise<{ reconciled: boolean; id: string; action: string }> {
    return liveFetch(`/intelligence/admin/legacy-sources/${sourceId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getMonitors(): Promise<{ monitors: import('../contracts/api').IntelMonitorDto[] }> {
    return liveFetch('/intelligence/monitors');
  },

  async createMonitor(payload: {
    kind: 'keyword' | 'author_list' | 'community_bundle';
    name: string;
    config: import('../contracts/api').IntelMonitorDto['config'];
    scheduleIntervalHours?: number;
    dailyItemBudget?: number;
    enabled?: boolean;
    projectId?: string;
  }): Promise<{ monitor: import('../contracts/api').IntelMonitorDto }> {
    return liveFetch('/intelligence/monitors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateMonitor(
    id: string,
    payload: {
      revision: number;
      name?: string;
      scheduleIntervalHours?: number;
      dailyItemBudget?: number;
      enabled?: boolean;
      projectId?: string | null;
    },
  ): Promise<{ monitor: import('../contracts/api').IntelMonitorDto }> {
    return liveFetch(`/intelligence/monitors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteMonitor(id: string, revision: number): Promise<{ deleted: true }> {
    return liveFetch(`/intelligence/monitors/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ revision }),
    });
  },

  async getQuotasSummary(): Promise<QuotasSummaryResponse> {
    return liveFetch('/quotas/summary');
  },

  async updatePlanPolicy(
    tier: PlanTier,
    payload: Omit<PlanPolicyDto, 'planTier' | 'updatedAt'>,
  ): Promise<{ policy: PlanPolicyDto }> {
    return liveFetch(`/quotas/plans/${tier}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async updateUserQuotaOverride(
    userId: string,
    payload: QuotaOverrideDto | null,
  ): Promise<{ updated: boolean; quotaOverride: QuotaOverrideDto | null }> {
    return liveFetch(`/quotas/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getDocs(): Promise<DocSummary[]> {
    return (await liveFetch<{ docs: DocSummary[] }>('/docs')).docs;
  },

  async getDoc(slug: string): Promise<DocDetail> {
    return (await liveFetch<{ doc: DocDetail }>(`/docs/${encodeURIComponent(slug)}`)).doc;
  },

  async createDoc(input: DocInput): Promise<DocDetail> {
    return (
      await liveFetch<{ doc: DocDetail }>('/docs', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    ).doc;
  },

  async updateDoc(id: string, patch: DocPatch): Promise<DocDetail> {
    return (
      await liveFetch<{ doc: DocDetail }>(`/docs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    ).doc;
  },

  async deleteDoc(id: string): Promise<{ deleted: boolean }> {
    return liveFetch(`/docs/${id}`, { method: 'DELETE' });
  },

  async getFeedStream(params: {
    mode?: FeedMode;
    topic?: string;
    platform?: Platform;
    language?: string;
    includeNews?: boolean;
    limit?: number;
    excludeIds?: string[];
  }): Promise<FeedStreamResponseDto> {
    const qs = new URLSearchParams();
    if (params.mode) qs.set('mode', params.mode);
    if (params.topic) qs.set('topic', params.topic);
    if (params.platform) qs.set('platform', params.platform);
    if (params.language) qs.set('language', params.language);
    if (params.includeNews !== undefined) qs.set('includeNews', String(params.includeNews));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.excludeIds?.length) qs.set('excludeIds', params.excludeIds.slice(0, 120).join(','));
    const q = qs.toString();
    return liveFetch(`/feed/stream${q ? `?${q}` : ''}`);
  },

  async getFeedHot(params: {
    window?: '6h' | '24h' | '48h' | '7d';
    platform?: Platform;
    topic?: string;
    limit?: number;
    offset?: number;
  }): Promise<FeedHotResponseDto> {
    const qs = new URLSearchParams();
    if (params.window) qs.set('window', params.window);
    if (params.platform) qs.set('platform', params.platform);
    if (params.topic) qs.set('topic', params.topic);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return liveFetch(`/feed/hot${q ? `?${q}` : ''}`);
  },

  async recordFeedEvents(events: Array<{
    contentId: string;
    eventType: FeedEventType;
    dwellMs?: number;
    meta?: Record<string, string>;
  }>): Promise<{ accepted: number }> {
    return liveFetch('/feed/events', {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  },

  async getFeedPreferences(): Promise<FeedPreferencesDto> {
    return liveFetch('/feed/preferences');
  },

  async updateFeedPreferences(patch: Partial<Pick<FeedPreferencesDto,
    'exploreRatio' | 'followedTopics' | 'mutedSources' | 'mutedKeywords' | 'mutedAuthors' | 'includeNewsLane'
  >>): Promise<FeedPreferencesDto> {
    return liveFetch('/feed/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async resetFeedPreferences(): Promise<{ reset: true }> {
    return liveFetch('/feed/preferences/reset', { method: 'POST', body: '{}' });
  },

  async getFeedAdminSummary(): Promise<FeedAdminSummaryDto> {
    return liveFetch('/feed/admin/summary');
  },

  async pruneFeedAdmin(): Promise<{ deletedSeen: number; deletedEvents: number }> {
    return liveFetch('/feed/admin/prune', { method: 'POST', body: '{}' });
  },

  async getMonitorOverview(monitorId: string, params?: { days?: number; bucket?: '6h' | '1d' }): Promise<MonitorOverviewResponseDto> {
    const qs = new URLSearchParams();
    if (params?.days) qs.set('days', String(params.days));
    if (params?.bucket) qs.set('bucket', params.bucket);
    const q = qs.toString();
    return liveFetch(`/intelligence/monitors/${encodeURIComponent(monitorId)}/overview${q ? `?${q}` : ''}`);
  },

  async getMonitorPosts(monitorId: string, params?: {
    sort?: 'heat' | 'score' | 'comments' | 'views' | 'newest';
    platform?: Platform;
    intent?: string;
    community?: string;
    author?: string;
    domain?: string;
    days?: number;
    limit?: number;
    offset?: number;
  }): Promise<MonitorPostsResponseDto> {
    const qs = new URLSearchParams();
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.intent) qs.set('intent', params.intent);
    if (params?.community) qs.set('community', params.community);
    if (params?.author) qs.set('author', params.author);
    if (params?.domain) qs.set('domain', params.domain);
    if (params?.days) qs.set('days', String(params.days));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return liveFetch(`/intelligence/monitors/${encodeURIComponent(monitorId)}/posts${q ? `?${q}` : ''}`);
  },

  async getTrackedAuthors(params?: {
    platform?: 'reddit' | 'x';
    monitorId?: string;
    search?: string;
    sort?: 'followers' | 'engagement' | 'posts';
    limit?: number;
  }): Promise<{ items: AuthorDirectoryRowDto[] }> {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.monitorId) qs.set('monitorId', params.monitorId);
    if (params?.search) qs.set('search', params.search);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return liveFetch(`/intelligence/authors${q ? `?${q}` : ''}`);
  },

  async getAuthorProfile(platform: 'reddit' | 'x', handle: string, params?: { days?: number; monitorId?: string }): Promise<AuthorProfileResponseDto> {
    const qs = new URLSearchParams();
    if (params?.days) qs.set('days', String(params.days));
    if (params?.monitorId) qs.set('monitorId', params.monitorId);
    const q = qs.toString();
    return liveFetch(`/intelligence/authors/${platform}/${encodeURIComponent(handle)}${q ? `?${q}` : ''}`);
  },

  async getMonitoredCommunities(params?: {
    monitorId?: string;
    days?: number;
    sort?: 'heat' | 'posts' | 'comments';
    limit?: number;
  }): Promise<{ items: CommunityMatrixRowDto[] }> {
    const qs = new URLSearchParams();
    if (params?.monitorId) qs.set('monitorId', params.monitorId);
    if (params?.days) qs.set('days', String(params.days));
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return liveFetch(`/intelligence/communities${q ? `?${q}` : ''}`);
  },

  async getCommunityDeepDive(subreddit: string, params?: { days?: number; monitorId?: string }): Promise<CommunityDeepDiveResponseDto> {
    const qs = new URLSearchParams();
    if (params?.days) qs.set('days', String(params.days));
    if (params?.monitorId) qs.set('monitorId', params.monitorId);
    const q = qs.toString();
    return liveFetch(`/intelligence/communities/${encodeURIComponent(subreddit)}${q ? `?${q}` : ''}`);
  },

  async getIntelligenceOpsSummary(): Promise<IntelligenceOpsSummaryDto> {
    return liveFetch('/intelligence/admin/ops-summary');
  },

  async reconcileAdminMonitor(
    id: string,
    payload: { action: 'pause' | 'resume' | 'refresh_rollups'; revision: number },
  ): Promise<{ updated: boolean; action: string; revision: number; updatedBuckets: number }> {
    return liveFetch(`/intelligence/admin/monitors/${encodeURIComponent(id)}/reconcile`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export function docFileUrl(slug: string): string {
  return `/api/v1/docs/${encodeURIComponent(slug)}/file`;
}
