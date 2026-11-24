import { useCallback, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { formatApiError, useL1ResearchQuery, useL2ResearchQuery, useResearchScopeQuery } from '@/api/hooks';
import type { Project } from '@/contracts/api';
import type { L2ComparisonRequest } from '@/contracts/research';
import { useI18n } from '@/i18n/translations';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { L1OverviewTab } from './L1OverviewTab';
import { L2ComparisonTab } from './L2ComparisonTab';
import { L3DeepResearchTab } from './L3DeepResearchTab';
import { ResearchScopeBar } from './ResearchScopeBar';
import {
  createDefaultScopeDraft,
  draftToScopeRequest,
  type ScopeDraftState,
} from './scopeUtils';

const STORAGE_PREFIX = 'siftline.research.scope.';

function readStoredDraft(projectId: string): ScopeDraftState | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ScopeDraftState;
  } catch {
    return null;
  }
}

function saveStoredDraft(projectId: string, draft: ScopeDraftState): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(draft));
  } catch {
    // ignore storage quota
  }
}

export function ContentResearchWorkspace({
  project,
  initialLayer = 'l1',
  exportDisabled,
  onOpenContentDetail,
  onNavigate,
}: {
  project: Project;
  initialLayer?: 'l1' | 'l2' | 'l3';
  exportDisabled?: boolean;
  onOpenContentDetail: (contentId: string) => void;
  onNavigate: (path: string) => void;
}) {
  const { lang, t } = useI18n();
  const [activeLayer, setActiveLayer] = useState<'l1' | 'l2' | 'l3'>(initialLayer);

  const scopeQuery = useResearchScopeQuery(project.id, true);
  const tree = scopeQuery.data;

  const [overridesByProject, setOverridesByProject] = useState<
    Record<string, { draft?: ScopeDraftState; applied?: ScopeDraftState }>
  >({});

  const defaultDraft = useMemo(() => createDefaultScopeDraft(tree), [tree]);
  const storedDraft = useMemo(() => readStoredDraft(project.id), [project.id]);
  const projectOverride = overridesByProject[project.id];
  const currentDraft = projectOverride?.draft ?? storedDraft ?? defaultDraft;
  const currentApplied = projectOverride?.applied ?? storedDraft ?? defaultDraft;

  const appliedRequest = useMemo(
    () => draftToScopeRequest(currentApplied, tree, lang),
    [currentApplied, tree, lang],
  );

  const [l2CompareMode, setL2CompareMode] = useState<'target' | 'batch'>('target');
  const [l2Sensitivity, setL2Sensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  const [l2WindowSplitDate, setL2WindowSplitDate] = useState<string>('');

  const l2Request: L2ComparisonRequest = useMemo(
    () => ({
      ...appliedRequest,
      compareMode: l2CompareMode,
      anomalySensitivity: l2Sensitivity,
      ...(l2WindowSplitDate ? { windowSplitAt: `${l2WindowSplitDate}T00:00:00.000Z` } : {}),
    }),
    [appliedRequest, l2CompareMode, l2Sensitivity, l2WindowSplitDate],
  );

  const l1Query = useL1ResearchQuery(
    project.id,
    appliedRequest,
    Boolean(tree) && activeLayer === 'l1',
  );
  const l2Query = useL2ResearchQuery(
    project.id,
    l2Request,
    Boolean(tree) && activeLayer === 'l2',
  );

  const keywordLabels = useMemo(() => {
    if (!tree) return [];
    const batchSet = new Set(currentApplied.selectedBatchIds ?? []);
    const srcSet = new Set(currentApplied.selectedSourceIds ?? []);
    const hasBatches = tree.targetGroups.some((g) => g.batches.length > 0);
    return tree.targetGroups
      .filter((g) =>
        hasBatches
          ? g.batches.some((b) => batchSet.has(b.batchId))
          : g.sourceIds.some((id) => srcSet.has(id)),
      )
      .map((g) => g.label);
  }, [tree, currentApplied]);

  const handleApply = useCallback(() => {
    saveStoredDraft(project.id, currentDraft);
    setOverridesByProject((prev) => ({
      ...prev,
      [project.id]: { draft: currentDraft, applied: currentDraft },
    }));
  }, [project.id, currentDraft]);

  const handleReset = useCallback(() => {
    const def = createDefaultScopeDraft(tree);
    saveStoredDraft(project.id, def);
    setOverridesByProject((prev) => ({
      ...prev,
      [project.id]: { draft: def, applied: def },
    }));
  }, [project.id, tree]);

  const handleClearTargets = useCallback(() => {
    const hasBatches = tree?.targetGroups.some((g) => g.batches.length > 0) ?? false;
    const nextDraft: ScopeDraftState = {
      ...currentDraft,
      selectedBatchIds: hasBatches ? [] : undefined,
      selectedSourceIds: !hasBatches ? [] : undefined,
    };
    setOverridesByProject((prev) => ({
      ...prev,
      [project.id]: { ...prev[project.id], draft: nextDraft },
    }));
  }, [project.id, tree, currentDraft]);

  const handleTraceToSearch = useCallback(
    (extra: Record<string, string | string[] | undefined>, label?: string) => {
      saveStoredDraft(project.id, currentApplied);
      const sp = new URLSearchParams();
      sp.set('projectId', project.id);
      if (appliedRequest.from) sp.set('from', appliedRequest.from);
      if (appliedRequest.to) sp.set('to', appliedRequest.to);
      if (appliedRequest.timeBasis && appliedRequest.timeBasis !== 'published') {
        sp.set('timeBasis', appliedRequest.timeBasis);
      }
      if (appliedRequest.batchIds?.length) {
        for (const bid of appliedRequest.batchIds) sp.append('batchIds', bid);
      }
      if (appliedRequest.sourceIds?.length) {
        for (const sid of appliedRequest.sourceIds) sp.append('sourceIds', sid);
      }
      if (appliedRequest.platforms?.length === 1 && !extra.platform) {
        sp.set('platform', appliedRequest.platforms[0]);
      }
      if (appliedRequest.kinds?.length === 1 && !extra.kind) {
        sp.set('kind', appliedRequest.kinds[0]);
      }
      if (appliedRequest.signal && !extra.signal) {
        sp.set('signal', appliedRequest.signal);
      }
      if (appliedRequest.threadAware !== undefined) {
        sp.set('threadAware', String(appliedRequest.threadAware));
      }
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === '') continue;
        sp.delete(k);
        if (Array.isArray(v)) {
          for (const item of v) sp.append(k, item);
        } else {
          sp.set(k, v);
        }
      }
      sp.set('fromResearch', '1');
      sp.set('researchLayer', activeLayer);
      if (label) sp.set('researchLabel', label);
      onNavigate(`/content?${sp.toString()}`);
    },
    [project.id, currentApplied, appliedRequest, activeLayer, onNavigate],
  );

  return (
    <div data-research-workspace="" className="space-y-4">
      <ResearchScopeBar
        tree={tree}
        draft={currentDraft}
        applied={currentApplied}
        onDraftChange={(next) =>
          setOverridesByProject((prev) => ({
            ...prev,
            [project.id]: { ...prev[project.id], draft: next },
          }))
        }
        onApply={handleApply}
        onReset={handleReset}
        onClearTargets={handleClearTargets}
        dataVersion={l1Query.data?.dataVersion ?? tree?.dataVersion}
        generatedAt={l1Query.data?.generatedAt}
        isFetching={l1Query.isFetching || scopeQuery.isFetching}
      />

      <Tabs
        value={activeLayer}
        onValueChange={(val) => {
          if (val === 'l1' || val === 'l2' || val === 'l3') setActiveLayer(val);
        }}
        className="w-full"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <TabsList>
            <TabsTrigger value="l1">{t('Basic Overview', '基础概览')}</TabsTrigger>
            <TabsTrigger value="l2">{t('Topics & Comparison', '主题与比较')}</TabsTrigger>
            <TabsTrigger value="l3">{t('Deep Research', '深入研究')}</TabsTrigger>
          </TabsList>

          {tree && tree.dateBounds.totalCount === 0 && project.dataset_mode === 'batch' && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onNavigate(`/projects?view=collect&projectId=${encodeURIComponent(project.id)}`)}
            >
              <Sparkles size={12} />
              <span>{t('Add research data', '去添加研究数据')}</span>
            </Button>
          )}
        </div>

        <TabsContent value="l1">
          <L1OverviewTab
            data={l1Query.data}
            isLoading={scopeQuery.isPending || l1Query.isPending}
            error={
              scopeQuery.isError
                ? formatApiError(scopeQuery.error)
                : l1Query.isError
                  ? formatApiError(l1Query.error)
                  : null
            }
            onRetry={() => {
              void scopeQuery.refetch();
              void l1Query.refetch();
            }}
            keywordLabels={keywordLabels}
            exportDisabled={exportDisabled}
            onOpenContentDetail={onOpenContentDetail}
            onTraceToSearch={handleTraceToSearch}
          />
        </TabsContent>

        <TabsContent value="l2">
          <L2ComparisonTab
            data={l2Query.data}
            isLoading={scopeQuery.isPending || l2Query.isPending}
            error={
              scopeQuery.isError
                ? formatApiError(scopeQuery.error)
                : l2Query.isError
                  ? formatApiError(l2Query.error)
                  : null
            }
            onRetry={() => {
              void scopeQuery.refetch();
              void l2Query.refetch();
            }}
            compareMode={l2CompareMode}
            onCompareModeChange={setL2CompareMode}
            sensitivity={l2Sensitivity}
            onSensitivityChange={setL2Sensitivity}
            windowSplitAt={l2WindowSplitDate}
            onWindowSplitAtChange={setL2WindowSplitDate}
            keywordLabels={keywordLabels}
            exportDisabled={exportDisabled}
            onTraceToSearch={handleTraceToSearch}
          />
        </TabsContent>

        <TabsContent value="l3">
          <L3DeepResearchTab
            projectId={project.id}
            projectName={project.name}
            scope={appliedRequest}
            dataVersion={l1Query.data?.dataVersion ?? l2Query.data?.dataVersion ?? tree?.dataVersion}
            keywordLabels={keywordLabels}
            exportDisabled={exportDisabled}
            onOpenContentDetail={onOpenContentDetail}
            onTraceToSearch={handleTraceToSearch}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
