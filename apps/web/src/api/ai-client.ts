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
  const res = await fetch(path, {
    credentials: 'include',
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
    aiFetch<{ items: AiBenchmarkSnapshotItem[]; configured: boolean }>(`/v1/ai/rankings${toQs({ category })}`),

  // Admin endpoints
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
    syncSource: useMutation({
      mutationFn: ({ code, dryRun }: { code: string; dryRun?: boolean }) => aiApi.triggerSync(code, dryRun),
      onSuccess: invalidate,
    }),
  };
}
