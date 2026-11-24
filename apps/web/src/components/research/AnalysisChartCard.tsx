import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  Info,
  RefreshCw,
  Table2,
} from 'lucide-react';
import type { AnalysisBlock } from '@/contracts/research';
import {
  buildAnalysisCsv,
  buildAnalysisTxt,
  triggerBlobDownload,
  triggerDataUrlDownload,
  type ExportTableColumn,
  type ExportTraceMetadata,
} from '@/lib/researchExport';
import { useI18n } from '@/i18n/translations';
import { EChartBox, type EChartInstance, type EChartOption } from '../charts/EChartBox';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Empty } from '../ui/empty';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Skeleton } from '../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';

export interface AnalysisChartCardProps {
  title: string;
  subtitle: string;
  block?: AnalysisBlock<unknown>;
  projectName: string;
  keywordLabels: string[];
  option: EChartOption | null;
  height?: number;
  columns: ExportTableColumn[];
  rows: Array<Record<string, unknown>>;
  controls?: React.ReactNode;
  summaryOverride?: string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onChartEvents?: Record<string, (params: unknown) => void>;
  onTraceEvidence?: () => void;
  traceLabel?: string;
  exportDisabled?: boolean;
  defaultView?: 'chart' | 'table';
  chartOnly?: boolean;
  tableOnly?: boolean;
  customBody?: React.ReactNode;
  className?: string;
}

function formatScopeTimeLabel(block?: AnalysisBlock<unknown>): string {
  if (!block) return '—';
  const from = block.scope.from ? block.scope.from.slice(0, 10) : '不限起始';
  const to = block.scope.to ? block.scope.to.slice(0, 10) : '不限截止';
  const basis = block.scope.timeBasis === 'collected' ? '采集时间' : '发布时间';
  return `${basis}: ${from} ~ ${to} UTC`;
}

export function AnalysisChartCard({
  title,
  subtitle,
  block,
  projectName,
  keywordLabels,
  option,
  height = 260,
  columns,
  rows,
  controls,
  summaryOverride,
  isLoading = false,
  error = null,
  onRetry,
  onChartEvents,
  onTraceEvidence,
  traceLabel,
  exportDisabled = false,
  defaultView = 'chart',
  chartOnly = false,
  tableOnly = false,
  customBody,
  className = '',
}: AnalysisChartCardProps) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<'chart' | 'table'>(tableOnly ? 'table' : defaultView);
  const [copied, setCopied] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const chartRef = useRef<EChartInstance | null>(null);

  const effectiveSummary = summaryOverride ?? block?.summaryText ?? '';
  const isEmpty = !isLoading && !error && (block?.status === 'empty' || (rows.length === 0 && !customBody));

  const traceMeta: ExportTraceMetadata = useMemo(
    () => ({
      projectName,
      analysisId: block?.analysisId ?? 'analysis',
      analysisTitle: title,
      methodVersion: block?.methodVersion ?? '1.0.0',
      dataVersion: block?.dataVersion ?? '—',
      keywords: keywordLabels,
      batchesCount: block?.scope.selectedBatchIds.length ?? 0,
      timeRangeLabel: formatScopeTimeLabel(block),
      coverageLabel: block?.coverage.label ?? 'stored_sample',
      methodologyNote: block?.methodology.notes.join(' ') || block?.methodology.denominatorLabel || '',
      generatedAt: block?.generatedAt ?? new Date().toISOString(),
    }),
    [block, keywordLabels, projectName, title],
  );

  const handleCopySummary = async () => {
    if (!effectiveSummary) return;
    try {
      await navigator.clipboard.writeText(effectiveSummary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setExportNote(t('Clipboard permission denied.', '无法访问剪贴板。'));
    }
  };

  const handleExportCsv = () => {
    setExportNote(null);
    const csv = buildAnalysisCsv(traceMeta, columns, rows);
    const slug = (block?.analysisId ?? 'analysis').toLowerCase();
    triggerBlobDownload(`siftline-${slug}-${traceMeta.dataVersion}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleExportTxt = () => {
    setExportNote(null);
    const txt = buildAnalysisTxt(
      traceMeta,
      effectiveSummary,
      block?.summaryBullets ?? [],
      columns,
      rows,
    );
    const slug = (block?.analysisId ?? 'analysis').toLowerCase();
    triggerBlobDownload(`siftline-${slug}-${traceMeta.dataVersion}.txt`, txt, 'text/plain;charset=utf-8');
  };

  const handleExportPng = () => {
    setExportNote(null);
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) {
      setExportNote(t('Switch to Chart view to export PNG image.', '请先切换到「图表」视图再导出 PNG 图像。'));
      return;
    }
    const dataUrl = chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });
    const slug = (block?.analysisId ?? 'analysis').toLowerCase();
    triggerDataUrlDownload(`siftline-${slug}-${traceMeta.dataVersion}.png`, dataUrl);
  };

  return (
    <Card className={`gap-3 py-4 shadow-xs ${className}`}>
      <CardHeader className="gap-1.5 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
              {block && (
                <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                  {block.analysisId} · {block.sampleCount.toLocaleString()} {t('items', '条')}
                </Badge>
              )}
            </div>
            <CardDescription className="mt-0.5 text-xs">{subtitle}</CardDescription>
          </div>

          <div className="flex items-center gap-1.5">
            {block && (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button type="button" variant="ghost" size="xs" aria-label={t('Methodology', '统计口径说明')} />
                  }
                >
                  <Info size={13} />
                  <span>{t('Methodology', '口径')}</span>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-2 text-xs">
                  <div className="font-semibold text-foreground">{t('Statistical Methodology', '统计口径与范围说明')}</div>
                  <div className="space-y-1 text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">{t('Deduplication', '去重依据')}：</span>
                      {block.methodology.dedupBasis === 'thread_root_anchor'
                        ? t('Thread-root anchor', '按讨论根帖去重')
                        : t('Canonical content ID', '按内容唯一标识去重')}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{t('Denominator', '占比分母')}：</span>
                      {block.methodology.denominatorLabel}（{block.methodology.denominatorValue.toLocaleString()}）
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{t('Coverage', '数据覆盖')}：</span>
                      {block.coverage.label}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{t('Data version', '数据版本')}：</span>
                      <code className="font-mono text-[11px]">{block.dataVersion}</code>
                    </div>
                  </div>
                  {block.methodology.notes.length > 0 && (
                    <ul className="list-disc space-y-1 border-t border-border pt-2 pl-4 text-[11px] text-muted-foreground">
                      {block.methodology.notes.map((note, idx) => (
                        <li key={idx}>{note}</li>
                      ))}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={exportDisabled || isLoading || isEmpty}
                  />
                }
              >
                <Download size={12} />
                <span>{t('Export', '导出')}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCsv}>
                  <Download size={12} />
                  <span>{t('Export Data (CSV)', '导出数据表格 (CSV)')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportTxt}>
                  <Download size={12} />
                  <span>{t('Export Summary (TXT)', '导出文字报告 (TXT)')}</span>
                </DropdownMenuItem>
                {!tableOnly && !customBody && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExportPng}>
                      <Download size={12} />
                      <span>{t('Export Chart Image (PNG)', '导出图表图像 (PNG)')}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {(controls || (!chartOnly && !tableOnly)) && (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">{controls}</div>
            {!chartOnly && !tableOnly && (
              <ToggleGroup
                value={[viewMode]}
                onValueChange={(next) => {
                  const picked = next[next.length - 1];
                  if (picked === 'chart' || picked === 'table') setViewMode(picked);
                }}
                aria-label={t('Chart or table view', '图表与表格切换')}
              >
                <ToggleGroupItem value="chart">
                  <BarChart3 size={12} />
                  <span>{t('Chart', '图表')}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="table">
                  <Table2 size={12} />
                  <span>{t('Table', '数据表格')}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="w-full rounded-lg" style={{ height }} />
          </div>
        ) : error ? (
          <Alert variant="destructive" className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
            {onRetry && (
              <Button type="button" variant="outline" size="xs" onClick={onRetry}>
                <RefreshCw size={12} />
                <span>{t('Retry', '重试')}</span>
              </Button>
            )}
          </Alert>
        ) : isEmpty ? (
          <Empty
            title={
              block?.scope.emptySelection
                ? t('No research targets selected', '尚未选择研究范围')
                : t('No matching data in scope', '当前研究范围内暂无数据')
            }
            description={effectiveSummary || t('Adjust keywords, batches, or date range above.', '请调整上方的关键词、数据批次或时间筛选条件。')}
          />
        ) : viewMode === 'table' || tableOnly ? (
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  {columns.map((c) => (
                    <TableHead key={c.key} className="h-8 text-[11px] font-semibold text-muted-foreground">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={idx}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className="py-1.5 text-xs tabular-nums">
                        {String(row[c.key] ?? '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : customBody ? (
          customBody
        ) : option ? (
          <EChartBox
            option={option}
            height={height}
            ariaLabel={title}
            onEvents={onChartEvents}
            onChartReady={(inst) => {
              chartRef.current = inst;
            }}
          />
        ) : null}

        {!isLoading && !error && effectiveSummary && !isEmpty && (
          <div className="rounded-lg border border-border/70 bg-muted/35 p-2.5 text-xs leading-relaxed text-foreground">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">
                {t('Chart Interpretation', '图表解读')}
              </span>
              <Button type="button" variant="ghost" size="xs" onClick={handleCopySummary}>
                {copied ? <Check size={11} /> : <Copy size={11} />}
                <span>{copied ? t('Copied', '已复制') : t('Copy', '复制')}</span>
              </Button>
            </div>
            <p className="m-0 text-xs text-foreground/90">{effectiveSummary}</p>
          </div>
        )}

        {exportNote && (
          <div className="text-[11px] text-amber-700" role="status">
            {exportNote}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>{block?.coverage.label ?? 'stored_sample'}</span>
          <span>·</span>
          <span>{formatScopeTimeLabel(block)}</span>
          {block && (
            <>
              <span>·</span>
              <span>
                {t('Generated', '更新')}: {block.generatedAt.slice(11, 19)} UTC
              </span>
            </>
          )}
        </div>
        {onTraceEvidence && !isEmpty && !isLoading && (
          <Button type="button" variant="link" size="xs" className="h-auto p-0 text-[11px]" onClick={onTraceEvidence}>
            <span>{traceLabel || t('Inspect matching content', '查看对应原文')}</span>
            <ExternalLink size={11} />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
