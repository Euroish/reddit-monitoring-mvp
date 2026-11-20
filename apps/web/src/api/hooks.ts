import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  type CollectionSource,
  type ContentFacetsQuery,
  type CredentialProviderName,
  type ListQuery,
  type MachineScope,
  type ProjectInput,
  type PullProviderName,
  type SourceInput,
  type StoryQuery,
} from '../contracts/api';
import { apiClient } from './client';

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => apiClient.getSession(),
    retry: false,
  });
}

export function usePublicSourcesQuery(enabled = true) {
  return useQuery({
    queryKey: ['publicSources'],
    queryFn: () => apiClient.getPublicSources(),
    staleTime: 60_000,
    enabled,
  });
}

export function useStoriesQuery(query: StoryQuery, enabled = true) {
  return useQuery({
    queryKey: ['stories', query],
    queryFn: () => apiClient.getStories(query),
    enabled,
  });
}

export function useInfiniteStoriesQuery(query: Omit<StoryQuery, 'offset'>, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['storiesInfinite', query],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiClient.getStories({
        ...query,
        offset: pageParam > 0 ? pageParam : undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled,
  });
}

export function useContentFacetsQuery(query: ContentFacetsQuery | null, enabled = true) {
  return useQuery({
    queryKey: ['contentFacets', query],
    queryFn: () => apiClient.getContentFacets(query!),
    enabled: enabled && Boolean(query),
  });
}

export function useCapabilitiesQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => apiClient.getCapabilities(),
    enabled,
  });
}

export function useProjectsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.getProjects(),
    enabled,
  });
}

export function useProjectOverviewQuery(projectId: string | undefined, revision: number | undefined) {
  return useQuery({
    queryKey: ['overview', projectId, revision ?? 0],
    queryFn: () => apiClient.getProjectOverview(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useContentListQuery(query: ListQuery, pathProjectId?: string, enabled = true) {
  return useQuery({
    queryKey: ['content', { ...query, pathProjectId }],
    queryFn: () => apiClient.listContent(query, pathProjectId),
    enabled,
  });
}

export function useContentDetailQuery(contentId: string | null) {
  return useQuery({
    queryKey: ['contentDetail', contentId],
    queryFn: () => apiClient.getContentDetail(contentId!),
    enabled: Boolean(contentId),
  });
}

export function useThreadQuery(
  contentId: string | null,
  scopeQuery: ListQuery,
  view: 'top' | 'matches' | 'op',
) {
  return useQuery({
    queryKey: ['thread', contentId, scopeQuery, view],
    queryFn: () => apiClient.getContentThread(contentId!, { ...scopeQuery, view }),
    enabled: Boolean(contentId),
  });
}

export function useSourcesQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => apiClient.getSources(),
    enabled,
  });
}

export function useBudgetsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: () => apiClient.getBudgets(),
    enabled,
  });
}

export function useSourceJobsQuery(sourceId: string | null) {
  return useQuery({
    queryKey: ['jobs', sourceId],
    queryFn: () => apiClient.getSourceJobs(sourceId!),
    enabled: Boolean(sourceId),
    refetchInterval: (q) => {
      const list = q.state.data?.jobs || [];
      return list.some((j) => j.status === 'queued' || j.status === 'running') ? 3500 : false;
    },
  });
}

export function useBatchJobsQuery(jobIds: string[]) {
  return useQuery({
    queryKey: ['jobsBatch', jobIds],
    queryFn: () => apiClient.getJobsByIds(jobIds),
    enabled: jobIds.length > 0,
    refetchInterval: (q) => {
      const list = q.state.data?.jobs || [];
      return list.some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false;
    },
  });
}

export function useJobDetailQuery(jobId: string | null) {
  return useQuery({
    queryKey: ['jobDetail', jobId],
    queryFn: () => apiClient.getJobDetail(jobId!),
    enabled: Boolean(jobId),
  });
}

export function useSavedQueriesQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['queries'],
    queryFn: () => apiClient.getSavedQueries(),
    enabled,
  });
}

export function useAnnotationsListQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['annotations'],
    queryFn: () => apiClient.getAnnotations(),
    enabled,
  });
}

export function useAnnotationQuery(contentId: string | null) {
  return useQuery({
    queryKey: ['annotation', contentId],
    queryFn: () => apiClient.getAnnotation(contentId!),
    enabled: Boolean(contentId),
  });
}

export function useMachineKeysQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['accessKeys'],
    queryFn: () => apiClient.getMachineKeys(),
    enabled,
  });
}

// Mutations enforcing Section 2.3 Invalidation Matrix
export function useLoginMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      apiClient.login(email, password),
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useRegisterMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password, invite }: { email: string; password: string; invite?: string }) =>
      apiClient.register(email, password, invite),
    onSuccess: (res) => {
      if (res.user) {
        qc.clear();
        qc.invalidateQueries({ queryKey: ['session'] });
      }
    },
  });
}

export function useLogoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.logout(),
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useCreateProjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) => apiClient.createProject(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });
}

export function useUpdateProjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProjectInput & { revision: number } }) =>
      apiClient.updateProject(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });
}

export function useDeleteProjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      apiClient.deleteProject(id, revision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });
}

export function useCreateSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceInput) => apiClient.createSource(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useUpdateSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { fallbackProvider?: 'scrapebadger' | 'red_crawler' | null; state?: CollectionSource['state']; revision: number };
    }) => apiClient.updateSource(id, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['jobs', vars.id] });
    },
  });
}

export function useUnblockSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, acknowledgePotentialCharge }: { sourceId: string; acknowledgePotentialCharge: boolean }) =>
      apiClient.unblockSource(sourceId, acknowledgePotentialCharge),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['jobs', vars.sourceId] });
    },
  });
}

export function useCollectSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      sourceId: string;
      payload: {
        from: string;
        to: string;
        limit: number;
        includeComments?: boolean;
        useFallback?: boolean;
        maxCommentsPerPost?: number;
      };
      idempotencyKey: string;
    }) => apiClient.collectSource(args.sourceId, args.payload, args.idempotencyKey),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs', vars.sourceId] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

export function useRefreshSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sourceId: string; contentIds: string[]; idempotencyKey: string }) =>
      apiClient.refreshSource(args.sourceId, { contentIds: args.contentIds }, args.idempotencyKey),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs', vars.sourceId] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });
}

export function useIngestSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sourceId: string; rawJson: string; idempotencyKey: string }) =>
      apiClient.ingestSource(args.sourceId, args.rawJson, args.idempotencyKey),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs', vars.sourceId] });
      qc.invalidateQueries({ queryKey: ['content'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useHydrateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      contentIds: string[];
      maxCommentsPerPost: number;
      idempotencyKey: string;
    }) =>
      apiClient.hydrateProject(
        args.projectId,
        { contentIds: args.contentIds, maxCommentsPerPost: args.maxCommentsPerPost },
        args.idempotencyKey,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

export function useJobActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      jobId: string;
      sourceId: string;
      action: 'cancel' | 'retry' | 'continue';
      acknowledgePotentialCharge?: boolean;
    }) => apiClient.jobAction(args.jobId, args.action, args.acknowledgePotentialCharge),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs', vars.sourceId] });
      qc.invalidateQueries({ queryKey: ['jobDetail', vars.jobId] });
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

export function useUpdateBudgetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      provider: PullProviderName;
      payload: {
        enabled: boolean;
        dailyRequests: number;
        monthlyRequests: number;
        dailyResources: number;
        monthlyResources: number;
        minimumIntervalMs: number;
        revision: number;
      };
    }) => apiClient.updateBudget(args.provider, args.payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['capabilities'] });
    },
  });
}

export function useCreateSavedQueryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; filter: ListQuery }) => apiClient.createSavedQuery(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

export function useDeleteSavedQueryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteSavedQuery(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

export function useSaveAnnotationMutation(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { favorite: boolean; note: string; revision: number }) =>
      apiClient.putAnnotation(contentId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotation', contentId] });
      qc.invalidateQueries({ queryKey: ['annotations'] });
    },
  });
}

export function useCreateMachineKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      label: string;
      scopes: MachineScope[];
      allowedSourceIds: string[];
      expiresInDays: number;
    }) => apiClient.createMachineKey(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessKeys'] });
    },
  });
}

export function useRevokeMachineKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.revokeMachineKey(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessKeys'] });
    },
  });
}

export function useProviderCredentialsQuery(enabled = true) {
  return useQuery({
    queryKey: ['providerCredentials'],
    queryFn: () => apiClient.getProviderCredentials(),
    enabled,
  });
}

export function useSaveProviderCredentialMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      apiKey,
      revision,
    }: {
      provider: CredentialProviderName;
      apiKey: string;
      revision?: number;
    }) => apiClient.saveProviderCredential(provider, { apiKey, revision }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providerCredentials'] });
      qc.invalidateQueries({ queryKey: ['capabilities'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useRevokeProviderCredentialMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: CredentialProviderName) =>
      apiClient.revokeProviderCredential(provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providerCredentials'] });
      qc.invalidateQueries({ queryKey: ['capabilities'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useRecentJobsQuery(params: { status?: string; sourceId?: string; limit?: number; offset?: number } = {}, enabled = true) {
  return useQuery({
    queryKey: ['recentJobs', params],
    queryFn: () => apiClient.getRecentJobs(params),
    enabled,
  });
}

export function useQuotasSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: ['quotasSummary'],
    queryFn: () => apiClient.getQuotasSummary(),
    enabled,
  });
}

export function useUpdatePlanPolicyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tier,
      payload,
    }: {
      tier: 'free' | 'pro';
      payload: Parameters<typeof apiClient.updatePlanPolicy>[1];
    }) => apiClient.updatePlanPolicy(tier, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotasSummary'] });
    },
  });
}

export function useUpdateUserQuotaOverrideMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string;
      payload: Parameters<typeof apiClient.updateUserQuotaOverride>[1];
    }) => apiClient.updateUserQuotaOverride(userId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotasSummary'] });
      qc.invalidateQueries({ queryKey: ['accessUsers'] });
    },
  });
}

export function useUsersQuery(enabled = true) {
  return useQuery({
    queryKey: ['accessUsers'],
    queryFn: () => apiClient.getUsers(),
    enabled,
  });
}

export function useUpdateUserAccessMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { role?: 'admin' | 'viewer'; status?: 'active' | 'disabled'; planTier?: 'free' | 'pro' };
    }) => apiClient.updateUserAccess(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessUsers'] });
      qc.invalidateQueries({ queryKey: ['accessAudit'] });
    },
  });
}

export function useAccessAuditQuery(enabled = true) {
  return useQuery({
    queryKey: ['accessAudit'],
    queryFn: () => apiClient.getAccessAudit(),
    enabled,
  });
}

export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    const retry = err.retryAfterSeconds ? ` (Retry after ${err.retryAfterSeconds}s)` : '';
    return `[${err.status} · ${err.code}] ${err.message}${retry}`;
  }
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}
