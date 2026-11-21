import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../contracts/api';

export interface AiVendorItem {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  officialSite: string | null;
  blogUrl: string | null;
  changelogUrl: string | null;
  docsUrl: string | null;
  brandColor: string | null;
  sortOrder: number;
  active: boolean;
  modelCount: number;
  eventCount: number;
}

export interface AiEventReferenceItem {
  id: string;
  role: 'primary' | 'secondary' | 'registry';
  title: string | null;
  url: string;
  contentId: string | null;
  sourceTier: string;
  excerpt: string | null;
  capturedAt?: string;
}

export interface AiReleaseEventItem {
  id: string;
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  vendorColor: string | null;
  modelId: string | null;
  modelSlug: string | null;
  modelName: string | null;
  eventType: string;
  eventStatus: 'released' | 'announced_future' | 'deprecated' | 'retired';
  title: string;
  eventDate: string;
  datePrecision: 'day' | 'month' | 'unknown';
  officialAnnouncedOn: string | null;
  availableFrom: string | null;
  effectiveOn: string | null;
  summaryZh: string | null;
  summaryEn: string | null;
  keyChanges: string[];
  sourceTier: 'official' | 'historical_verified' | 'manual_verified';
  visibility: 'published' | 'unpublished';
  publishedAt: string | null;
  references: AiEventReferenceItem[];
}

export interface AiSpecObservation {
  id: string;
  sourceNamespace: string;
  observedAt: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  currency: string;
  priceUnit: string;
  inputPrice: string | null;
  outputPrice: string | null;
  cacheReadPrice: string | null;
  rawUnitNote: string | null;
  providerName: string | null;
}

export interface AiEventDetail extends AiReleaseEventItem {
  vendorSite: string | null;
  modelFamily: string | null;
  modelLifecycleStatus: string | null;
  versionChain: Array<{
    id: string;
    eventType: string;
    eventStatus: string;
    title: string;
    eventDate: string;
    datePrecision: string;
  }>;
  specs: AiSpecObservation[];
}

export interface AiOfficialUpdateItem {
  contentId: string;
  title: string;
  url: string | null;
  summary: string | null;
  publishedAt: string | null;
  sourceName: string;
  sourceTier: string | null;
  vendorSlug: string | null;
  vendorName: string | null;
  vendorColor: string | null;
  linkedEvents: Array<{ id: string; title: string; eventDate: string }>;
}

export interface AiBenchmarkSnapshotItem {
  id: string;
  providerCode: string;
  category: 'general' | 'coding' | 'reasoning' | 'speed_price';
  metricName: string;
  metricVersion: string | null;
  metricDirection: 'higher' | 'lower';
  unit: string | null;
  capturedAt: string;
  attributionText: string;
  attributionUrl: string | null;
  entries: Array<{
    id: string;
    externalModelId: string;
    modelId: string | null;
    modelName: string;
    vendorName: string | null;
    score: number;
    rank: number;
    providerSetting: string | null;
  }>;
}

export interface AiCandidateItem {
  id: string;
  status: string;
  priority: number;
  vendorId: string | null;
  vendorSlug: string | null;
  vendorName: string | null;
  modelId: string | null;
  modelName: string | null;
  title: string;
  suggestedEventType: string;
  suggestedDate: string | null;
  datePrecision: 'day' | 'month' | 'unknown';
  evidenceSummary: string | null;
  draftPayload: Record<string, unknown>;
  evidenceContentIds: string[];
  publishedEventId: string | null;
  reviewerNote: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiRegistrySourceItem {
  id: string;
  code: string;
  kind: string;
  endpointUrl: string;
  enabled: boolean;
  cadenceSeconds: number;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastError: string | null;
}

async function aiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/api/') ? path : `/api${path}`;
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const code = data?.error?.code || `http_${res.status}`;
    throw new ApiError(res.status, code, msg);
  }
  return data as T;
}

function toQs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const aiApi = {
  listVendors: () => aiFetch<{ items: AiVendorItem[] }>('/v1/ai/vendors'),
  listEvents: (q: { vendor?: string; eventType?: string; status?: string; from?: string; to?: string; q?: string; limit?: number }) =>
    aiFetch<{ items: AiReleaseEventItem[] }>(`/v1/ai/events${toQs(q)}`),
  getEventDetail: (id: string) => aiFetch<AiEventDetail>(`/v1/ai/events/${encodeURIComponent(id)}`),
  listUpdates: (q: { vendor?: string; limit?: number }) =>
    aiFetch<{ items: AiOfficialUpdateItem[] }>(`/v1/ai/updates${toQs(q)}`),
  listRankings: (category?: string) =>
    aiFetch<{
      items: AiBenchmarkSnapshotItem[];
      configured: boolean;
      publicRedistributionAllowed?: boolean;
      internalSnapshotCount?: number;
    }>(`/v1/ai/rankings${toQs({ category })}`),

  // Admin endpoints
  listAdminRankings: (category?: string) =>
    aiFetch<{ items: AiBenchmarkSnapshotItem[] }>(`/v1/admin/ai/rankings${toQs({ category })}`),
  getOpsSummary: (days = 7) =>
    aiFetch<{
      windowDays: number;
      shadowMode: boolean;
      llmConfigured: boolean;
      aaPublicRedistribution: boolean;
      metrics: {
        autoPublished: number;
        shadowPassed: number;
        shadowRejected: number;
        lowValueArchived: number;
        rolledBack: number;
      };
      openAlerts: Array<{ id: string; severity: string; sourceCode: string | null; message: string; createdAt: string }>;
      recentRuns: Array<{ sourceCode: string; status: string; runs: number; candidatesCreated: number }>;
      vendors: Array<{ id: string; slug: string; name: string; autoPublishEnabled: boolean; officialDomains: string[] }>;
    }>(`/v1/admin/ai/ops/summary${toQs({ days })}`),
  listOpsAudit: () =>
    aiFetch<{
      items: Array<{
        id: string;
        mode: string;
        vendorName: string | null;
        eventId: string | null;
        candidateId: string | null;
        confidence: number | null;
        ruleName: string;
        reason: string | null;
        createdAt: string;
      }>;
    }>('/v1/admin/ai/ops/audit'),
  runDiscovery: (body: { shadowMode?: boolean; lookbackHours?: number; archiveLowValue?: boolean }) =>
    aiFetch<{ scanned: number; autoPublished: number; shadowPassed: number; candidatesQueued: number; archived: number }>('/v1/admin/ai/discovery/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rollbackEvent: (id: string, reason?: string) =>
    aiFetch<{ id: string; visibility: string; rolledBack: boolean }>(`/v1/admin/ai/events/${encodeURIComponent(id)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  setVendorAutoPublish: (id: string, enabled: boolean) =>
    aiFetch<{ id: string; slug: string; autoPublishEnabled: boolean }>(`/v1/admin/ai/vendors/${encodeURIComponent(id)}/autopublish`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  resolveAlert: (id: string) =>
    aiFetch<{ id: string; resolvedAt: string }>(`/v1/admin/ai/alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  listQueue: (q: { status?: string; vendor?: string; limit?: number }) =>
    aiFetch<{ items: AiCandidateItem[] }>(`/v1/admin/ai/queue${toQs(q)}`),
  patchCandidate: (id: string, body: Record<string, unknown>) =>
    aiFetch<{ id: string; status: string; revision: number }>(`/v1/admin/ai/candidates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  publishCandidate: (id: string, body: Record<string, unknown>) =>
    aiFetch<{ eventId: string; candidateId: string; status: string }>(`/v1/admin/ai/candidates/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rejectCandidate: (id: string, body: { expectedRevision: number; status?: 'rejected' | 'deferred'; reviewerNote?: string }) =>
    aiFetch<{ id: string; status: string; revision: number }>(`/v1/admin/ai/candidates/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulkDismiss: (ids: string[], reviewerNote?: string) =>
    aiFetch<{ dismissed: number }>('/v1/admin/ai/candidates/bulk-dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids, reviewerNote }),
    }),
  unpublishEvent: (id: string, reason?: string) =>
    aiFetch<{ id: string; visibility: string }>(`/v1/admin/ai/events/${encodeURIComponent(id)}/unpublish`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  listSources: () => aiFetch<{ items: AiRegistrySourceItem[] }>('/v1/admin/ai/sources'),
  triggerSync: (code: string, dryRun = false) =>
    aiFetch<Record<string, unknown>>(`/v1/admin/ai/sources/${encodeURIComponent(code)}/sync`, {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),
};

export function useAiVendorsQuery(enabled = true) {
  return useQuery({ queryKey: ['ai', 'vendors'], queryFn: aiApi.listVendors, enabled, staleTime: 60_000 });
}

export function useAiEventsQuery(
  params: { vendor?: string; eventType?: string; status?: string; from?: string; to?: string; q?: string; limit?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ['ai', 'events', params],
    queryFn: () => aiApi.listEvents(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useAiEventDetailQuery(id: string | null) {
  return useQuery({
    queryKey: ['ai', 'event', id],
    queryFn: () => aiApi.getEventDetail(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useAiUpdatesQuery(params: { vendor?: string; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'updates', params],
    queryFn: () => aiApi.listUpdates(params),
    enabled,
    staleTime: 60_000,
  });
}

export function useAiRankingsQuery(category?: string, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'rankings', category ?? 'all'],
    queryFn: () => aiApi.listRankings(category),
    enabled,
    staleTime: 60_000,
  });
}

export function useAiQueueQuery(params: { status?: string; vendor?: string }, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'admin', 'queue', params],
    queryFn: () => aiApi.listQueue(params),
    enabled,
  });
}

export function useAiSourcesQuery(enabled = true) {
  return useQuery({
    queryKey: ['ai', 'admin', 'sources'],
    queryFn: aiApi.listSources,
    enabled,
  });
}

export function useAiOpsSummaryQuery(days = 7, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'admin', 'ops-summary', days],
    queryFn: () => aiApi.getOpsSummary(days),
    enabled,
  });
}

export function useAiOpsAuditQuery(enabled = true) {
  return useQuery({
    queryKey: ['ai', 'admin', 'ops-audit'],
    queryFn: aiApi.listOpsAudit,
    enabled,
  });
}

export function useAiAdminRankingsQuery(enabled = true) {
  return useQuery({
    queryKey: ['ai', 'admin', 'rankings'],
    queryFn: () => aiApi.listAdminRankings(),
    enabled,
  });
}

export function useAiAdminMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['ai'] });
  };
  return {
    publish: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => aiApi.publishCandidate(id, body),
      onSuccess: invalidate,
    }),
    reject: useMutation({
      mutationFn: ({ id, expectedRevision, status, reviewerNote }: { id: string; expectedRevision: number; status?: 'rejected' | 'deferred'; reviewerNote?: string }) =>
        aiApi.rejectCandidate(id, { expectedRevision, status, reviewerNote }),
      onSuccess: invalidate,
    }),
    bulkDismiss: useMutation({
      mutationFn: ({ ids, reviewerNote }: { ids: string[]; reviewerNote?: string }) => aiApi.bulkDismiss(ids, reviewerNote),
      onSuccess: invalidate,
    }),
    unpublish: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) => aiApi.unpublishEvent(id, reason),
      onSuccess: invalidate,
    }),
    rollback: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) => aiApi.rollbackEvent(id, reason),
      onSuccess: invalidate,
    }),
    runDiscovery: useMutation({
      mutationFn: (body: { shadowMode?: boolean; lookbackHours?: number; archiveLowValue?: boolean }) => aiApi.runDiscovery(body),
      onSuccess: invalidate,
    }),
    setVendorAutoPublish: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => aiApi.setVendorAutoPublish(id, enabled),
      onSuccess: invalidate,
    }),
    resolveAlert: useMutation({
      mutationFn: (id: string) => aiApi.resolveAlert(id),
      onSuccess: invalidate,
    }),
    syncSource: useMutation({
      mutationFn: ({ code, dryRun }: { code: string; dryRun?: boolean }) => aiApi.triggerSync(code, dryRun),
      onSuccess: invalidate,
    }),
  };
}
