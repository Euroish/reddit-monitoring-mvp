export interface ExportTraceMetadata {
  projectName: string;
  analysisId: string;
  analysisTitle: string;
  methodVersion: string;
  dataVersion: string;
  keywords: string[];
  batchesCount: number;
  timeRangeLabel: string;
  coverageLabel: string;
  methodologyNote: string;
  generatedAt: string;
}

export interface ExportTableColumn {
  key: string;
  label: string;
}

export function safeCsvCell(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw).replace(/[\r\n]+/g, ' ');
  const safe = /^[ \t]*[=+\-@]/.test(str) ? `'${str}` : str;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function triggerBlobDownload(filename: string, content: BlobPart, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function triggerDataUrlDownload(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function buildAnalysisCsv(
  meta: ExportTraceMetadata,
  columns: ExportTableColumn[],
  rows: Array<Record<string, unknown>>,
): string {
  const metaRows: string[][] = [
    ['# Project', meta.projectName],
    ['# Analysis', `${meta.analysisTitle} (${meta.analysisId})`],
    ['# Method Version', meta.methodVersion],
    ['# Data Version', meta.dataVersion],
    ['# Keywords', meta.keywords.length ? meta.keywords.join('; ') : 'All / None'],
    ['# Selected Batches', String(meta.batchesCount)],
    ['# Time Range', meta.timeRangeLabel],
    ['# Coverage', meta.coverageLabel],
    ['# Methodology', meta.methodologyNote],
    ['# Generated At', meta.generatedAt],
    [],
    columns.map((c) => c.label),
    ...rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))),
  ];
  return '\uFEFF' + metaRows.map((line) => line.map(safeCsvCell).join(',')).join('\r\n');
}

export function buildAnalysisTxt(
  meta: ExportTraceMetadata,
  summaryText: string,
  summaryBullets: string[],
  columns: ExportTableColumn[],
  rows: Array<Record<string, unknown>>,
): string {
  const lines: string[] = [
    `SIFTLINE 研究分析导出报告`,
    `========================================`,
    `所属项目：${meta.projectName}`,
    `分析项目：${meta.analysisTitle} (${meta.analysisId})`,
    `分析版本：${meta.methodVersion} | 数据版本：${meta.dataVersion}`,
    `采集关键词：${meta.keywords.length ? meta.keywords.join('、') : '全部/未指定'}`,
    `已选数据批次：${meta.batchesCount} 个`,
    `时间范围：${meta.timeRangeLabel}`,
    `覆盖口径：${meta.coverageLabel}`,
    `统计口径：${meta.methodologyNote}`,
    `生成时间：${meta.generatedAt}`,
    ``,
    `【图表解读】`,
    summaryText,
    ...(summaryBullets.length > 1 ? summaryBullets.map((b) => `- ${b}`) : []),
    ``,
    `【数据明细 (${rows.length} 行)】`,
    columns.map((c) => c.label).join('\t'),
    ...rows.map((r) => columns.map((c) => String(r[c.key] ?? '')).join('\t')),
  ];
  return lines.join('\r\n');
}
