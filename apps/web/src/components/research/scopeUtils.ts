import type { ContentKind, Platform } from '@/contracts/api';
import type { AnalysisScopeRequest, ResearchScopeTreeResponse } from '@/contracts/research';

export interface ScopeDraftState {
  selectedBatchIds: string[] | undefined;
  selectedSourceIds: string[] | undefined;
  presetDays: 'all' | '7' | '30' | '90' | 'custom';
  fromDate: string;
  toDate: string;
  timeBasis: 'published' | 'collected';
  platforms: Platform[];
  kinds: ContentKind[];
  communities: string[];
  languages: string[];
  signal: '' | 'discussion' | 'pain';
  threadAware: boolean;
}

export function createDefaultScopeDraft(tree?: ResearchScopeTreeResponse): ScopeDraftState {
  const allBatchIds = tree?.targetGroups.flatMap((g) => g.batches.map((b) => b.batchId)) ?? [];
  const allSourceIds = tree?.targetGroups.flatMap((g) => g.sourceIds) ?? [];
  return {
    selectedBatchIds: tree ? (allBatchIds.length > 0 ? allBatchIds : undefined) : undefined,
    selectedSourceIds: tree && allBatchIds.length === 0 ? allSourceIds : undefined,
    presetDays: 'all',
    fromDate: '',
    toDate: '',
    timeBasis: 'published',
    platforms: [],
    kinds: [],
    communities: [],
    languages: [],
    signal: '',
    threadAware: tree?.project.threadAware ?? true,
  };
}

export function draftToScopeRequest(
  draft: ScopeDraftState,
  tree: ResearchScopeTreeResponse | undefined,
  lang: 'zh' | 'en',
): AnalysisScopeRequest {
  const now = Date.now();
  let from: string | undefined;
  let to: string | undefined;
  if (draft.presetDays !== 'all' && draft.presetDays !== 'custom') {
    const days = Number(draft.presetDays);
    const endMs = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
    from = new Date(endMs - days * 86_400_000).toISOString();
    to = new Date(endMs).toISOString();
  } else if (draft.presetDays === 'custom') {
    if (draft.fromDate) from = `${draft.fromDate}T00:00:00.000Z`;
    if (draft.toDate) {
      const endMs = Date.parse(`${draft.toDate}T00:00:00.000Z`) + 86_400_000;
      if (Number.isFinite(endMs)) to = new Date(endMs).toISOString();
    }
  }

  const allBatchIds = tree?.targetGroups.flatMap((g) => g.batches.map((b) => b.batchId)) ?? [];
  const hasBatches = allBatchIds.length > 0;
  return {
    ...(hasBatches && draft.selectedBatchIds !== undefined ? { batchIds: draft.selectedBatchIds } : {}),
    ...(!hasBatches && draft.selectedSourceIds !== undefined ? { sourceIds: draft.selectedSourceIds } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    timeBasis: draft.timeBasis,
    ...(draft.platforms.length ? { platforms: draft.platforms } : {}),
    ...(draft.kinds.length ? { kinds: draft.kinds } : {}),
    ...(draft.communities.length ? { communities: draft.communities } : {}),
    ...(draft.languages.length ? { languages: draft.languages } : {}),
    ...(draft.signal ? { signal: draft.signal } : {}),
    threadAware: draft.threadAware,
    bucket: draft.presetDays === '7' ? '6h' : 'day',
    lang,
  };
}
