import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchApi, fetchApiBlob, getAuthEpoch } from '../../api/client';
import { Button, Input } from '../../components/ui';
import type { ContentExportResponse } from '../../../../../packages/contracts/src/http';

type ExportResult = { filters: string; format: 'json' | 'csv'; part: number; count: number | null; truncated: boolean | null; nextCursor: string | null };

export function ContentExport({ filters, zh }: { filters: string; zh: boolean }) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  const [maxItems, setMaxItems] = useState('2000');
  const [result, setResult] = useState<ExportResult | null>(null);
  const current = result?.filters === filters ? result : null;
  const limit = Number(maxItems);
  const validLimit = /^\d+$/.test(maxItems) && Number.isInteger(limit) && limit >= 1 && limit <= 2000;
  const download = useMutation({ mutationFn: async ({ format, next }: { format: 'json' | 'csv'; next: boolean }) => {
    const epoch = getAuthEpoch();
    const params = new URLSearchParams(filters);
    params.set('format', format); params.set('maxItems', String(limit));
    const part = next && current ? current.part + 1 : 1;
    if (next && current?.nextCursor) params.set('cursor', current.nextCursor);
    let blob: Blob;
    let count: number | null, truncated: boolean | null, nextCursor: string | null;
    if (format === 'json') {
      const data = await fetchApi<ContentExportResponse>(`/v1/content/export?${params}`);
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      count = data.exportedCount; truncated = data.truncated; nextCursor = data.nextCursor;
    } else {
      const response = await fetchApiBlob(`/v1/content/export?${params}`);
      blob = response.blob;
      const countHeader = response.headers.get('X-Export-Count');
      const truncatedHeader = response.headers.get('X-Export-Truncated');
      count = countHeader !== null && Number.isFinite(Number(countHeader)) ? Number(countHeader) : null;
      truncated = truncatedHeader === null ? null : truncatedHeader === 'true';
      nextCursor = response.headers.get('X-Export-Next-Cursor') || null;
    }
    return { blob, epoch, info: { filters, format, part, count, truncated, nextCursor } };
  }, onSuccess: ({ blob, epoch, info }) => {
    if (epoch !== getAuthEpoch()) return;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = `collected-content-part-${info.part}.${info.format}`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setResult(info);
  } });
  return <details><summary>{copy('Export matching saved content', '导出匹配的已存内容')}</summary>
    <div className="content-fields">
      <label>{copy('Export limit per file (1–2000)', '每文件导出上限（1–2000）')}<Input type="number" min={1} max={2000} step={1} value={maxItems} onChange={event => setMaxItems(event.target.value)} /></label>
      <Button type="button" disabled={!validLimit || download.isPending} onClick={() => download.mutate({ format: 'json', next: false })}>{copy('Download JSON', '下载 JSON')}</Button>
      <Button type="button" disabled={!validLimit || download.isPending} onClick={() => download.mutate({ format: 'csv', next: false })}>{copy('Download CSV', '下载 CSV')}</Button>
    </div>
    <p className="content-muted">{copy('Exports use the applied search filters and include source/observation evidence. Each file is bounded. Its metadata records truncation; it represents saved samples, not full-platform activity.', '导出使用已应用的查询条件并包含来源与观测证据。每文件有条数上限，元数据标明截断情况；导出代表已存样本，不代表平台全量。')}</p>
    {download.error && <p role="alert" className="content-error">{copy('Download error: ', '下载错误：')}{download.error.message.trim() || copy('Retry the download or refresh the saved results.', '请重试下载或刷新已存结果。')}</p>}
    {download.isPending && <p role="status">{copy('Preparing download…', '正在准备下载…')}</p>}
    {current && <p role="status">{copy('Downloaded part', '已下载分段')} {current.part} · {current.format.toUpperCase()} · {current.count ?? copy('Count in file metadata', '条数见文件元数据')}{current.truncated === true ? ` · ${copy('More matching content remains', '仍有匹配内容')}` : current.truncated === false ? ` · ${copy('Reached the end of this saved sample', '已到达该已存样本末尾')}` : ''}</p>}
    {current?.nextCursor && <Button type="button" disabled={!validLimit || download.isPending} onClick={() => download.mutate({ format: current.format, next: true })}>{copy('Download next part', '下载下一分段')}</Button>}
  </details>;
}
