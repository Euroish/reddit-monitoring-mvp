import { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Database,
  Filter,
  Layers,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type { ContentKind, Platform } from '@/contracts/api';
import type { ResearchScopeTreeResponse } from '@/contracts/research';
import { useI18n } from '@/i18n/translations';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Select } from '../ui/select';
import { Separator } from '../ui/separator';
import type { ScopeDraftState } from './scopeUtils';

export type { ScopeDraftState };

export function ResearchScopeBar({
  tree,
  draft,
  applied,
  onDraftChange,
  onApply,
  onReset,
  onClearTargets,
  dataVersion,
  generatedAt,
  isFetching,
}: {
  tree?: ResearchScopeTreeResponse;
  draft: ScopeDraftState;
  applied: ScopeDraftState;
  onDraftChange: (next: ScopeDraftState) => void;
  onApply: () => void;
  onReset: () => void;
  onClearTargets: () => void;
  dataVersion?: string;
  generatedAt?: string;
  isFetching?: boolean;
}) {
  const { t } = useI18n();
  const [targetPopOpen, setTargetPopOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState(false);

  const allBatchIds = useMemo(
    () => tree?.targetGroups.flatMap((g) => g.batches.map((b) => b.batchId)) ?? [],
    [tree],
  );
  const allSourceIds = useMemo(
    () => tree?.targetGroups.flatMap((g) => g.sourceIds) ?? [],
    [tree],
  );
  const hasBatches = allBatchIds.length > 0;

  const selectedBatchSet = useMemo(
    () => new Set(draft.selectedBatchIds ?? allBatchIds),
    [draft.selectedBatchIds, allBatchIds],
  );
  const selectedSourceSet = useMemo(
    () => new Set(draft.selectedSourceIds ?? allSourceIds),
    [draft.selectedSourceIds, allSourceIds],
  );

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(applied), [draft, applied]);

  const selectedTargetSummary = useMemo(() => {
    if (!tree || tree.targetGroups.length === 0) return t('No targets', '暂无采集对象');
    if (hasBatches) {
      const activeGroups = tree.targetGroups.filter((g) =>
        g.batches.some((b) => selectedBatchSet.has(b.batchId)),
      );
      if (selectedBatchSet.size === 0) return t('0 batches selected', '已清空范围（0 批次）');
      return t(
        `${activeGroups.length}/${tree.targetGroups.length} targets · ${selectedBatchSet.size}/${allBatchIds.length} batches`,
        `${activeGroups.length}/${tree.targetGroups.length} 个关键词 · ${selectedBatchSet.size}/${allBatchIds.length} 个批次`,
      );
    }
    if (selectedSourceSet.size === 0) return t('0 sources selected', '已清空范围（0 来源）');
    return t(
      `${selectedSourceSet.size}/${allSourceIds.length} sources`,
      `已选 ${selectedSourceSet.size}/${allSourceIds.length} 个来源`,
    );
  }, [tree, hasBatches, selectedBatchSet, allBatchIds.length, selectedSourceSet.size, allSourceIds.length, t]);

  const toggleGroup = (groupKey: string) => {
    const grp = tree?.targetGroups.find((g) => g.key === groupKey);
    if (!grp) return;
    if (hasBatches) {
      const grpBatches = grp.batches.map((b) => b.batchId);
      const allSelected = grpBatches.length > 0 && grpBatches.every((id) => selectedBatchSet.has(id));
      const next = new Set(selectedBatchSet);
      for (const id of grpBatches) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      onDraftChange({ ...draft, selectedBatchIds: [...next] });
    } else {
      const allSelected = grp.sourceIds.every((id) => selectedSourceSet.has(id));
      const next = new Set(selectedSourceSet);
      for (const id of grp.sourceIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      onDraftChange({ ...draft, selectedSourceIds: [...next] });
    }
  };

  const toggleBatch = (batchId: string) => {
    const next = new Set(selectedBatchSet);
    if (next.has(batchId)) next.delete(batchId);
    else next.add(batchId);
    onDraftChange({ ...draft, selectedBatchIds: [...next] });
  };

  const selectAllTargets = () => {
    onDraftChange({
      ...draft,
      selectedBatchIds: hasBatches ? [...allBatchIds] : undefined,
      selectedSourceIds: !hasBatches ? [...allSourceIds] : undefined,
    });
  };

  const togglePlatform = (p: Platform) => {
    const next = draft.platforms.includes(p)
      ? draft.platforms.filter((x) => x !== p)
      : [...draft.platforms, p];
    onDraftChange({ ...draft, platforms: next });
  };

  const toggleKind = (k: ContentKind) => {
    const next = draft.kinds.includes(k) ? draft.kinds.filter((x) => x !== k) : [...draft.kinds, k];
    onDraftChange({ ...draft, kinds: next });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Filter size={13} className="text-muted-foreground" />
            {t('Analysis Scope', '研究数据范围')}
          </span>
          {tree && (
            <Badge variant="secondary" className="text-[11px]">
              {tree.dateBounds.totalCount.toLocaleString()} {t('stored items in project', '条项目样本')}
            </Badge>
          )}
          {dataVersion && (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              v:{dataVersion}
            </Badge>
          )}
          {generatedAt && (
            <span className="text-[11px] text-muted-foreground">
              {t('Updated', '分析更新')}: {generatedAt.slice(11, 19)} UTC
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onReset}
            title={t('Restore default project scope', '恢复默认研究范围')}
          >
            <RotateCcw size={12} />
            <span>{t('Reset Scope', '恢复默认')}</span>
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={onApply}
            disabled={isFetching}
            variant={isDirty ? 'default' : 'secondary'}
          >
            <span>{isFetching ? t('Updating…', '计算中…') : isDirty ? t('Apply Scope', '应用到分析') : t('Refresh', '刷新分析')}</span>
          </Button>
        </div>
      </div>

      <Separator className="mb-2.5" />

      <div className="flex flex-wrap items-center gap-2">
        {/* 1. Keywords & Batches Tree Popover */}
        <Popover open={targetPopOpen} onOpenChange={setTargetPopOpen}>
          <PopoverTrigger
            render={
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" />
            }
          >
            <Database size={13} className="text-muted-foreground" />
            <span className="text-muted-foreground">{t('Targets & Batches', '关键词与批次')}:</span>
            <span className="font-semibold text-foreground">{selectedTargetSummary}</span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[360px] max-w-[92vw] space-y-2.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {t('Keywords & Data Batches', '采集关键词与数据批次')}
              </span>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="xs" onClick={selectAllTargets}>
                  {t('Select all', '全选')}
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={onClearTargets}>
                  {t('Clear', '清空')}
                </Button>
              </div>
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {(!tree || tree.targetGroups.length === 0) && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  {t('No collection targets or batches in this project yet.', '当前项目尚无采集关键词或数据批次。')}
                </div>
              )}

              {tree?.targetGroups.map((grp, idx) => {
                const grpBatchIds = grp.batches.map((b) => b.batchId);
                const selectedInGroup = hasBatches
                  ? grpBatchIds.filter((id) => selectedBatchSet.has(id)).length
                  : grp.sourceIds.filter((id) => selectedSourceSet.has(id)).length;
                const totalInGroup = hasBatches ? grpBatchIds.length : grp.sourceIds.length;
                const allChecked = totalInGroup > 0 && selectedInGroup === totalInGroup;
                const partial = selectedInGroup > 0 && selectedInGroup < totalInGroup;
                const isExpanded = expandedGroups[grp.key] ?? idx < 3;

                return (
                  <div key={grp.key} className="rounded-lg border border-border/70 bg-muted/20 p-2">
                    <div className="flex items-center gap-2">
                      {grp.batches.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedGroups((p) => ({ ...p, [grp.key]: !isExpanded }))}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t('Toggle batches', '展开/收起批次')}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                      <label className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = partial;
                            }}
                            onChange={() => toggleGroup(grp.key)}
                            className="size-3.5 accent-primary"
                          />
                          <span className="truncate">{grp.label}</span>
                        </span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {hasBatches
                            ? `${selectedInGroup}/${totalInGroup} ${t('batches', '批次')}`
                            : `${grp.platforms.join('/').toUpperCase()}`}
                        </span>
                      </label>
                    </div>

                    {isExpanded && grp.batches.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 pl-6">
                        {grp.batches.map((b) => (
                          <label key={b.batchId} className="flex cursor-pointer items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5 text-foreground/90">
                              <input
                                type="checkbox"
                                checked={selectedBatchSet.has(b.batchId)}
                                onChange={() => toggleBatch(b.batchId)}
                                className="size-3 accent-primary"
                              />
                              <span className="truncate">{b.label}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {b.itemCount} {t('items', '条')}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <Button type="button" variant="ghost" size="xs" onClick={onReset}>
                {t('Restore Default', '恢复默认范围')}
              </Button>
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  setTargetPopOpen(false);
                  onApply();
                }}
              >
                {t('Apply to Analysis', '应用到分析')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* 2. Content Time Range */}
        <div className="flex items-center gap-1.5">
          <Calendar size={13} className="text-muted-foreground" />
          <Select
            aria-label={t('Date range preset', '时间范围')}
            value={draft.presetDays}
            onChange={(e) => {
              const val = e.target.value as ScopeDraftState['presetDays'];
              onDraftChange({ ...draft, presetDays: val });
            }}
          >
            <option value="all">{t('All time', '全部时间')}</option>
            <option value="7">{t('Last 7 days', '近 7 天')}</option>
            <option value="30">{t('Last 30 days', '近 30 天')}</option>
            <option value="90">{t('Last 90 days', '近 90 天')}</option>
            <option value="custom">{t('Custom dates', '自定义日期')}</option>
          </Select>
          {draft.presetDays === 'custom' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                aria-label={t('From date', '开始日期')}
                value={draft.fromDate}
                onChange={(e) => onDraftChange({ ...draft, fromDate: e.target.value })}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
              />
              <span className="text-xs text-muted-foreground">~</span>
              <input
                type="date"
                aria-label={t('To date', '结束日期')}
                value={draft.toDate}
                onChange={(e) => onDraftChange({ ...draft, toDate: e.target.value })}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
              />
            </div>
          )}
        </div>

        {/* 3. Platform Popover */}
        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" />}
          >
            <span className="text-muted-foreground">{t('Platform', '平台')}:</span>
            <span className="font-semibold">
              {draft.platforms.length === 0 ? t('All', '全部') : draft.platforms.map((p) => p.toUpperCase()).join(', ')}
            </span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 space-y-1.5 p-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground">{t('Filter Platforms', '选择数据平台')}</div>
            {(['reddit', 'x', 'bluesky', 'web'] as Platform[]).map((p) => {
              const cnt = tree?.availablePlatforms.find((ap) => ap.platform === p)?.count ?? 0;
              return (
                <label key={p} className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.platforms.includes(p)}
                      onChange={() => togglePlatform(p)}
                      className="size-3.5 accent-primary"
                    />
                    <span>{p === 'x' ? 'X' : p.charAt(0).toUpperCase() + p.slice(1)}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">{cnt}</span>
                </label>
              );
            })}
          </PopoverContent>
        </Popover>

        {/* 4. Content Kind Popover */}
        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" />}
          >
            <Layers size={12} className="text-muted-foreground" />
            <span className="text-muted-foreground">{t('Type', '内容类型')}:</span>
            <span className="font-semibold">
              {draft.kinds.length === 0
                ? t('All', '全部')
                : draft.kinds
                    .map((k) => (k === 'post' ? t('Post', '帖文') : k === 'comment' ? t('Comment', '评论') : t('Article', '文章')))
                    .join(', ')}
            </span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 space-y-1.5 p-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground">{t('Content Type', '筛选内容类型')}</div>
            {(['post', 'comment', 'article'] as ContentKind[]).map((k) => {
              const cnt = tree?.availableKinds.find((ak) => ak.kind === k)?.count ?? 0;
              return (
                <label key={k} className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.kinds.includes(k)}
                      onChange={() => toggleKind(k)}
                      className="size-3.5 accent-primary"
                    />
                    <span>{k === 'post' ? t('Posts', '帖文') : k === 'comment' ? t('Comments', '评论') : t('Articles', '文章')}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">{cnt}</span>
                </label>
              );
            })}
          </PopoverContent>
        </Popover>

        {/* 5. More Conditions Collapsible Toggle */}
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger
            render={<Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" />}
          >
            <SlidersHorizontal size={12} />
            <span>{t('More Filters', '更多条件')}</span>
            {(draft.communities.length > 0 || draft.languages.length > 0 || draft.signal || draft.timeBasis === 'collected') && (
              <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">
                {draft.communities.length + draft.languages.length + (draft.signal ? 1 : 0) + (draft.timeBasis === 'collected' ? 1 : 0)}
              </Badge>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 w-full">
            <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/25 p-3 md:grid-cols-4">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">{t('Time Basis', '时间口径')}</div>
                <Select
                  value={draft.timeBasis}
                  onChange={(e) => onDraftChange({ ...draft, timeBasis: e.target.value as 'published' | 'collected' })}
                >
                  <option value="published">{t('Original publish time', '内容发布时间（默认）')}</option>
                  <option value="collected">{t('Collection time', '采集入库时间')}</option>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">{t('Discussion Signal', '讨论信号')}</div>
                <Select
                  value={draft.signal}
                  onChange={(e) => onDraftChange({ ...draft, signal: e.target.value as ScopeDraftState['signal'] })}
                >
                  <option value="">{t('All signals', '全部内容')}</option>
                  <option value="pain">{t('Pain signals', '痛点吐槽信号')}</option>
                  <option value="discussion">{t('High-reply threads', '高互动讨论')}</option>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">{t('Community', '社区过滤')}</div>
                <Select
                  value={draft.communities[0] ?? ''}
                  onChange={(e) =>
                    onDraftChange({ ...draft, communities: e.target.value ? [e.target.value] : [] })
                  }
                >
                  <option value="">{t('All communities', '全部社区')}</option>
                  {tree?.availableCommunities.map((c) => (
                    <option key={c.community} value={c.community}>
                      r/{c.community} ({c.count})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">{t('Language', '语种')}</div>
                <Select
                  value={draft.languages[0] ?? ''}
                  onChange={(e) =>
                    onDraftChange({ ...draft, languages: e.target.value ? [e.target.value] : [] })
                  }
                >
                  <option value="">{t('All languages', '全部语种')}</option>
                  {tree?.availableLanguages.map((l) => (
                    <option key={l.language} value={l.language}>
                      {l.language} ({l.count})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
