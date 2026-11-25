import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  HelpCircle,
  Layers,
  Minimize2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useI18n } from '@/i18n/translations';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type {
  EvaluatedPanel,
  PanelUserOverride,
  ResolvedPanelGroup,
} from './panelRegistry';

function ReasonTooltip({
  label,
  reason,
  recoveryHint,
  dependencies,
}: {
  label: string;
  reason?: string;
  recoveryHint?: string;
  dependencies?: readonly string[];
}) {
  const { t } = useI18n();
  if (!reason && !recoveryHint) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-help items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" />
        }
      >
        <HelpCircle size={10} />
        <span>{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 text-left leading-relaxed">
        {reason && <div>{reason}</div>}
        {recoveryHint && (
          <div className="opacity-85">
            {t('Restore condition:', '恢复条件：')} {recoveryHint}
          </div>
        )}
        {dependencies && dependencies.length > 0 && (
          <div className="font-mono text-[10px] opacity-75">
            {t('Requires:', '依赖条件：')} {dependencies.join(' · ')}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function CompactPanelCard({
  panel,
  onExpand,
  onCollapse,
  onResetSingle,
}: {
  panel: EvaluatedPanel;
  onExpand: () => void;
  onCollapse: () => void;
  onResetSingle?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card className="gap-2.5 py-3.5 shadow-xs transition-all duration-200">
      <CardHeader className="gap-1 border-b border-border/50 pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <CardTitle className="text-sm font-semibold text-foreground">{panel.title}</CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {t('Compact Summary', '精简展示')}
              </Badge>
              <ReasonTooltip
                label={t('Why compact', '精简原因')}
                reason={panel.autoReason}
                recoveryHint={panel.recoveryHint}
                dependencies={panel.dependencies}
              />
            </div>
            {panel.autoReason && (
              <CardDescription className="text-[11px] leading-snug">{panel.autoReason}</CardDescription>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {panel.userOverride && onResetSingle && (
              <Button type="button" variant="ghost" size="xs" onClick={onResetSingle}>
                <RotateCcw size={11} />
                <span>{t('Auto', '恢复自动')}</span>
              </Button>
            )}
            <Button type="button" variant="outline" size="xs" onClick={onExpand}>
              <Eye size={11} />
              <span>{t('Full Chart', '展开图表')}</span>
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={onCollapse} title={t('Collapse into Other Analysis', '折叠至「其他分析」')}>
              <EyeOff size={11} />
              <span>{t('Collapse', '折叠')}</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 pt-0.5">
        {panel.compactMetrics && panel.compactMetrics.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {panel.compactMetrics.map((m, idx) => (
              <div key={idx} className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
                <div className="truncate text-[10.5px] text-muted-foreground">{m.label}</div>
                <div className="mt-0.5 truncate text-sm font-bold tabular-nums text-foreground">{m.value}</div>
                {m.hint && <div className="truncate text-[10px] text-muted-foreground">{m.hint}</div>}
              </div>
            ))}
          </div>
        )}
        {panel.compactSummary && (
          <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
            {panel.compactSummary}
          </div>
        )}
        {panel.recoveryHint && (
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{t('Unlock full view:', '自动恢复条件：')}</span>
            {panel.recoveryHint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PanelAdaptiveHeaderExtras({
  panel,
  onSetOverride,
  onClearOverride,
}: {
  panel: EvaluatedPanel;
  onSetOverride: (panelId: string, next: PanelUserOverride) => void;
  onClearOverride: (panelId: string) => void;
}) {
  const { t } = useI18n();
  const isManualExpand = panel.userOverride === 'expanded' && panel.autoState !== 'full';

  return (
    <>
      {isManualExpand && (
        <ReasonTooltip
          label={t('Manual Expand', '已手动展开')}
          reason={panel.autoReason}
          recoveryHint={panel.recoveryHint}
        />
      )}
      {isManualExpand && (
        <Button type="button" variant="ghost" size="xs" onClick={() => onClearOverride(panel.id)}>
          <RotateCcw size={11} />
          <span>{t('Auto', '恢复自动')}</span>
        </Button>
      )}
      {panel.compactCapable && !isManualExpand && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onSetOverride(panel.id, 'compact')}
          title={t('Switch to compact summary card', '切换为精简摘要卡')}
        >
          <Minimize2 size={11} />
          <span>{t('Compact', '精简')}</span>
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onSetOverride(panel.id, 'collapsed')}
        title={t('Collapse panel into Other Analysis', '折叠并收纳至底部「其他分析」')}
      >
        <EyeOff size={11} />
        <span>{t('Collapse', '折叠')}</span>
      </Button>
    </>
  );
}

export function AdaptiveLayerLayout({
  group,
  onSetOverride,
  onClearOverride,
  onResetAll,
  renderFullPanel,
  statusPrefix,
  className = '',
}: {
  group: ResolvedPanelGroup;
  onSetOverride: (panelId: string, next: PanelUserOverride) => void;
  onClearOverride: (panelId: string) => void;
  onResetAll: () => void;
  renderFullPanel: (panel: EvaluatedPanel, headerExtras: React.ReactNode) => React.ReactNode;
  statusPrefix?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [otherOpen, setOtherOpen] = useState(false);

  const hiddenCount = group.collapsed.length + group.unavailable.length;
  const hiddenPreviewTitles = [...group.collapsed, ...group.unavailable]
    .slice(0, 3)
    .map((p) => p.title)
    .join('、');

  return (
    <TooltipProvider>
      <div className={`space-y-4 ${className}`}>
        {/* Adaptive Policy Status Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            {statusPrefix}
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Sparkles size={12} className="text-primary" />
              {t('Adaptive Layout:', '自适应展示状态：')}
            </span>
            <span>
              {t(
                `${group.counts.full} full · ${group.counts.compact} compact · ${group.counts.collapsed} auto-collapsed · ${group.counts.unavailable} unavailable`,
                `完整展示 ${group.counts.full} 项 · 精简摘要 ${group.counts.compact} 项 · 已折叠 ${group.counts.collapsed} 项 · 暂不可用 ${group.counts.unavailable} 项`,
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {group.hasOverrides && (
              <Button type="button" variant="outline" size="xs" onClick={onResetAll}>
                <RotateCcw size={11} />
                <span>{t('Restore Auto Layout', '恢复自动布局')}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Active Panels Responsive Grid (zero-hole dense span allocation) */}
        {group.active.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {group.active.map((panel) => {
              const colClass = panel.resolvedSpan === 'full' ? 'lg:col-span-2' : 'lg:col-span-1';
              if (panel.effectiveState === 'compact') {
                return (
                  <div key={panel.id} className={`${colClass} min-w-0 transition-all duration-200`}>
                    <CompactPanelCard
                      panel={panel}
                      onExpand={() => onSetOverride(panel.id, 'expanded')}
                      onCollapse={() => onSetOverride(panel.id, 'collapsed')}
                      onResetSingle={panel.userOverride ? () => onClearOverride(panel.id) : undefined}
                    />
                  </div>
                );
              }
              return (
                <div key={panel.id} className={`${colClass} min-w-0 transition-all duration-200`}>
                  {renderFullPanel(
                    panel,
                    <PanelAdaptiveHeaderExtras
                      panel={panel}
                      onSetOverride={onSetOverride}
                      onClearOverride={onClearOverride}
                    />,
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed py-6 text-center">
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">
                {t('All panels in this layer are currently collapsed or unavailable.', '当前层级下所有分析面板均因单一维度或样本不足处于折叠/暂不可用状态。')}
              </div>
              <div>
                {t('Open "Other Analysis" below to inspect fold reasons or manually expand a panel.', '可展开下方「其他分析」查看具体折叠原因、恢复条件，或手动展开关注的分析卡片。')}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bottom Collapsible Shelf: Other Analysis ("其他分析") */}
        {hiddenCount > 0 && (
          <Collapsible open={otherOpen} onOpenChange={setOtherOpen}>
            <Card className="gap-0 overflow-hidden py-0 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/25 px-4 py-2.5">
                <CollapsibleTrigger
                  render={
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-xs font-semibold text-foreground hover:text-primary"
                    />
                  }
                >
                  {otherOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Layers size={13} className="text-muted-foreground" />
                  <span>{t('Other Analysis', '其他分析')}</span>
                  {group.collapsed.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t(`${group.collapsed.length} collapsed`, `自动/手动折叠 ${group.collapsed.length} 项`)}
                    </Badge>
                  )}
                  {group.unavailable.length > 0 && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {t(`${group.unavailable.length} unavailable`, `暂不可用 ${group.unavailable.length} 项`)}
                    </Badge>
                  )}
                  {!otherOpen && hiddenPreviewTitles && (
                    <span className="hidden truncate text-[11px] font-normal text-muted-foreground md:inline">
                      — {hiddenPreviewTitles}
                      {hiddenCount > 3 ? ` ${t(`+${hiddenCount - 3} more`, `等 ${hiddenCount} 项`)}` : ''}
                    </span>
                  )}
                </CollapsibleTrigger>

                <div className="flex shrink-0 items-center gap-2">
                  {group.hasOverrides && (
                    <Button type="button" variant="ghost" size="xs" onClick={onResetAll}>
                      <RotateCcw size={11} />
                      <span>{t('Restore Auto Layout', '恢复自动布局')}</span>
                    </Button>
                  )}
                  <CollapsibleTrigger
                    render={
                      <Button type="button" variant="outline" size="xs" />
                    }
                  >
                    <span>{otherOpen ? t('Hide', '收起列表') : t('Inspect & Expand', '展开查看')}</span>
                  </CollapsibleTrigger>
                </div>
              </div>

              <CollapsibleContent className="border-t border-border/60 bg-card px-4 py-3 transition-all duration-200">
                <div className="space-y-3">
                  {group.collapsed.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold text-muted-foreground">
                        {t('Collapsed Panels (Low differentiation or manually folded)', '已折叠面板（分析维度单一 / 低信息密度或手动收起）')}
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        {group.collapsed.map((panel) => (
                          <div
                            key={panel.id}
                            className="flex flex-col justify-between gap-2 rounded-lg border border-border/80 bg-muted/15 p-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="font-semibold text-foreground">{panel.title}</span>
                                <div className="flex items-center gap-1">
                                  {panel.metricPreview && (
                                    <Badge variant="outline" className="font-mono text-[10px]">
                                      {panel.metricPreview}
                                    </Badge>
                                  )}
                                  <Badge variant="secondary" className="text-[10px]">
                                    {panel.userOverride === 'collapsed'
                                      ? t('Manual', '手动折叠')
                                      : t('Auto-folded', '自动折叠')}
                                  </Badge>
                                </div>
                              </div>
                              {panel.autoReason && (
                                <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
                                  <strong className="text-foreground/80">{t('Reason:', '折叠原因：')}</strong>
                                  {panel.autoReason}
                                </p>
                              )}
                              {panel.recoveryHint && (
                                <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
                                  <strong className="text-foreground/80">{t('Recovery:', '恢复条件：')}</strong>
                                  {panel.recoveryHint}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                              {panel.compactCapable && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => onSetOverride(panel.id, 'compact')}
                                >
                                  <Minimize2 size={11} />
                                  <span>{t('Show Compact', '精简展示')}</span>
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => onSetOverride(panel.id, 'expanded')}
                              >
                                <Eye size={11} />
                                <span>{t('Expand Panel', '手动展开')}</span>
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {group.unavailable.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold text-muted-foreground">
                        {t('Unavailable Panels (Insufficient data or unmet prerequisites)', '暂不可用面板（数据缺失或条件尚未满足）')}
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        {group.unavailable.map((panel) => (
                          <div
                            key={panel.id}
                            className="space-y-1 rounded-lg border border-dashed border-border bg-muted/10 p-3 text-xs opacity-90"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{panel.title}</span>
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                {t('Unavailable', '暂不可用')}
                              </Badge>
                            </div>
                            {panel.autoReason && (
                              <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
                                <strong className="text-foreground/80">{t('Reason:', '原因说明：')}</strong>
                                {panel.autoReason}
                              </p>
                            )}
                            {panel.recoveryHint && (
                              <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
                                <strong className="text-foreground/80">{t('Unlock condition:', '解锁条件：')}</strong>
                                {panel.recoveryHint}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}
      </div>
    </TooltipProvider>
  );
}
