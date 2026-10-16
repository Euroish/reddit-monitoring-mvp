import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchApi, fetchApiBlob, getAuthEpoch } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Input, Select } from '../../components/ui';
import { canonicalContentQuery, contentQueryPath } from './queryState';
import { downloadResearchBlob, researchCsvMetadata, researchPageParams, validateResearchPage } from './researchExportState';
import type { SavedContentQuery } from '../../../../../packages/contracts/src/source-content';
import type { ResearchExportListResponse, ResearchExportManifest, ResearchExportPageResponse, ResearchExportResponse, ResearchExportView } from '../../../../../packages/contracts/src/research-export';

export function CreateResearchExport({ query, zh }: { query: SavedContentQuery; zh: boolean }) {
  const { user } = useAuth(), client = useQueryClient();
  const copy = (en: string, cn: string) => zh ? cn : en;
  const [name, setName] = useState(''), [maxRows, setMaxRows] = useState('20000'), [unknownOutcome, setUnknownOutcome] = useState(false);
  const limit = Number(maxRows), validLimit = /^\d+$/u.test(maxRows) && Number.isInteger(limit) && limit >= 1 && limit <= 20000;
  const create = useMutation({ mutationFn: () => fetchApi<ResearchExportResponse>('/v1/research-exports', { method: 'POST', body: JSON.stringify({ name: name.trim(), query: canonicalContentQuery(query), maxRows: limit }) }),
    onSuccess: () => { setName(''); void client.invalidateQueries({ queryKey: ['researchExports', user?.id] }); },
    onError: error => { if (error instanceof ApiError && error.code === 'audit_result_unknown') { setUnknownOutcome(true); void client.invalidateQueries({ queryKey: ['researchExports', user?.id] }); } },
  });
  return <details className="content-research-create"><summary>{copy('Freeze matching content for research', '冻结匹配内容用于研究')}</summary>
    <p className="content-muted">{copy('Creates one private snapshot of the complete matching stored sample, with fixed members, content, scoped observations, source configuration and denominator. It does not freeze the whole platform or start a provider request. Ordinary export above reads current saved content and may change between pages.', '为完整匹配的已存样本创建个人快照，固定成员、内容、范围内观测、来源配置和分母。快照不代表平台全量，也不会启动 provider 请求；上方即时导出读取当前已存内容，续页期间可能变化。')}</p>
    <form className="content-fields" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
      <label htmlFor="research-export-name">{copy('Research export name', '研究导出名称')}<Input id="research-export-name" maxLength={100} required disabled={create.isPending} value={name} onChange={event => { setName(event.target.value); if (!unknownOutcome) create.reset(); }} /></label>
      <label htmlFor="research-export-max-rows">{copy('Maximum snapshot rows (1–20000)', '快照条数上限（1–20000）')}<Input id="research-export-max-rows" type="number" min={1} max={20000} step={1} disabled={create.isPending} value={maxRows} onChange={event => setMaxRows(event.target.value)} /></label>
      <Button type="submit" disabled={!name.trim() || !validLimit || create.isPending || unknownOutcome}>{copy('Create frozen export', '创建冻结导出')}</Button>
    </form>
    <p className="content-muted">{copy('The entire snapshot must fit the selected row cap and 32 MiB UTF-8 payload limit. Oversized queries are rejected without silently truncating members. Download pages contain at most 100 records.', '完整快照必须在所选条数上限及 32 MiB UTF-8 载荷上限内，超限时拒绝创建，不会悄悄截断成员。每个下载分段最多 100 条。')}</p>
    {create.isPending && <p role="status">{copy('Freezing stored sample…', '正在冻结已存样本…')}</p>}
    {create.error && <p role="alert" className="content-error">{create.error.message}{create.error instanceof ApiError && create.error.status === 413 ? ` ${copy('Narrow the applied filters before creating another snapshot.', '请收紧已应用筛选条件后再创建。')}` : ''}</p>}
    {unknownOutcome && <p role="alert">{copy('The snapshot may already exist. Inspect your research exports before creating it again. ', '快照可能已经创建，请先核对个人研究导出再重新创建。')}<Link to="/saved">{copy('Inspect research exports', '检查研究导出')}</Link></p>}
    {create.data && <p role="status">{copy('Frozen export created. Fixed sample total', '冻结导出已创建，固定样本总数')} {create.data.researchExport.total} · <Link to={`/saved?research=${encodeURIComponent(create.data.researchExport.id)}`}>{copy('Open frozen export', '打开冻结导出')}</Link></p>}
  </details>;
}

function ManifestView({ manifest, zh }: { manifest: ResearchExportManifest; zh: boolean }) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  return <div className="content-research-manifest">
    <p className="content-summary">{copy('Fixed sample total', '固定样本总数')}: <strong>{manifest.total}</strong> · {manifest.scope}</p>
    <dl className="content-detail-fields"><dt>{copy('Frozen at', '冻结时刻')}</dt><dd>{new Date(manifest.frozenAt).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {manifest.frozenAt}</dd><dt>{copy('Text scope', '正文范围')}</dt><dd>{manifest.textScope}</dd><dt>{copy('Observation selection', '观测选择规则')}</dt><dd>{manifest.observationSelection}</dd><dt>{copy('Manifest version', 'Manifest 版本')}</dt><dd>{manifest.formatVersion}</dd><dt>{copy('Content contract', '内容契约')}</dt><dd>{manifest.contentContractVersion}</dd><dt>{copy('Query contract', '查询契约')}</dt><dd>{manifest.queryContractVersion}</dd><dt>{copy('Identity version', '身份版本')}</dt><dd>{manifest.identityVersion}</dd></dl>
    <p data-testid="research-coverage">{copy('Frozen member index coverage', '冻结成员索引覆盖')}: {manifest.coverage.indexed}/{manifest.total} · {copy('Stored body text present', '有已存正文')} {manifest.coverage.textPresent} · {copy('Body text missing', '正文缺失')} {manifest.coverage.textMissing}</p>
    <p className="content-muted">{copy('Coverage counts refer to this frozen member set. Known empty body text counts as present; title alone does not. Missing metrics stay null; metric units cannot be inferred or combined across platforms.', '覆盖计数仅针对本次冻结成员；已知空正文计为有正文，仅有标题不计入。缺失指标保留 null，不能推断单位或跨平台合并。')}</p>
    <details><summary>{copy('Frozen metric definitions and units', '冻结的指标定义与单位')}</summary>{manifest.metricDefinitions.length === 0 ? <p>{copy('No registered metric definitions in this snapshot.', '此快照没有已注册的指标定义。')}</p> : <ul>{manifest.metricDefinitions.map(definition => <li key={definition.key}>{definition.label} · {definition.key} · {copy('Unit', '单位')}: {definition.unit} · {definition.cumulative ? copy('Cumulative', '累计') : copy('Non-cumulative', '非累计')} · {definition.signed ? copy('Signed', '可负值') : copy('Unsigned', '非负值')} · {definition.direction} · {definition.contentKinds.join(', ')}</li>)}</ul>}</details>
    <details><summary>{copy('Frozen sources and filters', '冻结的来源与筛选')}</summary><ul>{manifest.sources.map(source => <li key={source.id}>{source.label} · {source.platform} · {source.provider} · {source.id}{source.group ? ` · ${source.group}` : ''}</li>)}</ul><pre className="content-platform-fields">{JSON.stringify(manifest.query, null, 2)}</pre><Link to={contentQueryPath(manifest.query)}>{copy('Run these filters against current content', '用这些筛选查询当前内容')}</Link><p className="content-muted">{copy('Current content can differ from this frozen snapshot.', '当前内容可能与此冻结快照不同。')}</p></details>
    <details><summary>{copy('Snapshot limitations and complete manifest', '快照边界与完整 manifest')}</summary><ul>{manifest.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul><pre className="content-platform-fields">{JSON.stringify(manifest, null, 2)}</pre></details>
    <Button type="button" onClick={() => downloadResearchBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json;charset=utf-8' }), 'research-manifest.json')}>{copy('Download manifest JSON', '下载 manifest JSON')}</Button>
  </div>;
}

function FrozenContentPages({ view, zh }: { view: ResearchExportView; zh: boolean }) {
  const { user } = useAuth(), copy = (en: string, cn: string) => zh ? cn : en;
  const [limit, setLimit] = useState(100), [paging, setPaging] = useState({ limit: 100, cursor: '', previous: [] as string[] });
  const cursor = paging.limit === limit ? paging.cursor : '', previous = paging.limit === limit ? paging.previous : [];
  const params = researchPageParams(limit, cursor);
  const page = useQuery({ queryKey: ['researchExportPage', user?.id, view.id, limit, cursor], queryFn: async ({ signal }) => { const response = await fetchApi<ResearchExportPageResponse>(`/v1/research-exports/${encodeURIComponent(view.id)}/content?${params}`, { signal }); validateResearchPage(response, view.id, view.total, limit); return response; }, retry: false });
  const [downloaded, setDownloaded] = useState<{ cursor: string; format: string; count: number } | null>(null);
  const csv = useMutation({ mutationFn: async () => { const epoch = getAuthEpoch(); const response = await fetchApiBlob(`/v1/research-exports/${encodeURIComponent(view.id)}/export?format=csv&${params}`); const metadata = researchCsvMetadata(response.headers, view.total, limit); if (page.data && (metadata.count !== page.data.items.length || metadata.nextCursor !== page.data.nextCursor)) throw new Error(copy('CSV and JSON page metadata differ. Refresh before downloading.', 'CSV 与 JSON 分段元数据不一致，请刷新后再下载。')); return { ...response, ...metadata, cursor, epoch, part: previous.length + 1 }; }, onSuccess: response => { if (!downloadResearchBlob(response.blob, `frozen-research-${view.id}-part-${response.part}.csv`, response.epoch)) return; setDownloaded({ cursor: response.cursor, format: 'CSV', count: response.count }); } });
  const json = () => { if (!page.data || page.isError) return; validateResearchPage(page.data, view.id, view.total, limit); downloadResearchBlob(new Blob([JSON.stringify(page.data, null, 2)], { type: 'application/json;charset=utf-8' }), `frozen-research-${view.id}-part-${previous.length + 1}.json`); setDownloaded({ cursor, format: 'JSON', count: page.data.items.length }); };
  return <section aria-labelledby="frozen-members-title"><h3 id="frozen-members-title">{copy('Frozen content pages', '冻结内容分段')}</h3>
    <p className="content-muted">{copy('Every file records the fixed total, manifest and continuation cursor. JSON preserves null and string IDs. CSV includes manifest metadata and payload_json for original types, with formula and numeric-ID protection. Downloads stay bounded; no automatic full-dataset download occurs.', '每个文件记录固定总数、manifest 与续页游标；JSON 保留 null 与字符串 ID，CSV 包含 manifest 元数据及保留原始类型的 payload_json，并保护公式与数字 ID。下载按有界分段执行，不自动下载整个数据集。')}</p>
    <label className="content-page-size" htmlFor="frozen-page-size">{copy('Records per frozen page', '每个冻结分段条数')}<Select id="frozen-page-size" aria-label={copy('Records per frozen page', '每个冻结分段条数')} disabled={csv.isPending} value={limit} onChange={event => { setLimit(Number(event.target.value)); csv.reset(); setDownloaded(null); }}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</Select></label>
    {page.isLoading && <p role="status">{copy('Loading frozen page…', '正在读取冻结分段…')}</p>}
    {page.error && <p role="alert" className="content-error">{page.error.message} <Button onClick={() => void page.refetch()}>{copy('Retry frozen page', '重试冻结分段')}</Button></p>}
    {page.data && !page.isError && <><p>{copy('Records on this page', '当前分段条数')} {page.data.items.length} · {copy('Fixed sample total', '固定样本总数')} {page.data.total} · {copy('Page', '分段')} {previous.length + 1}</p><ul className="content-frozen-members">{page.data.items.map(item => <li key={item.id}><span>{item.title || item.text?.slice(0, 100) || `${item.kind} · ${item.externalId}`}</span><span className="content-muted">{item.platform} · {item.kind} · ID {item.externalId}</span></li>)}</ul></>}
    <div className="content-actions"><Button type="button" disabled={!page.data || page.isError || page.isFetching || csv.isPending} onClick={json}>{copy('Download this frozen page as JSON', '下载当前冻结分段 JSON')}</Button><Button type="button" disabled={!page.data || page.isError || page.isFetching || csv.isPending} onClick={() => csv.mutate()}>{copy('Download this frozen page as CSV', '下载当前冻结分段 CSV')}</Button></div>
    {csv.error && <p role="alert" className="content-error">{csv.error.message}</p>}
    {downloaded?.cursor === cursor && <p role="status">{copy('Downloaded current frozen page', '已下载当前冻结分段')} · {downloaded.format} · {downloaded.count}/{view.total}</p>}
    <div className="content-pager"><Button type="button" disabled={!previous.length || page.isFetching || csv.isPending} onClick={() => { setPaging({ limit, cursor: previous.at(-1) ?? '', previous: previous.slice(0, -1) }); setDownloaded(null); csv.reset(); }}>{copy('Previous frozen page', '上一个冻结分段')}</Button><Button type="button" disabled={!page.data?.nextCursor || page.isError || page.isFetching || csv.isPending} onClick={() => { setPaging({ limit, previous: [...previous, cursor], cursor: page.data?.nextCursor ?? '' }); setDownloaded(null); csv.reset(); }}>{copy('Next frozen page', '下一个冻结分段')}</Button></div>
  </section>;
}

export function ResearchExports({ zh }: { zh: boolean }) {
  const { user } = useAuth(), client = useQueryClient(), [params, setParams] = useSearchParams();
  const copy = (en: string, cn: string) => zh ? cn : en, selected = params.get('research') ?? '';
  const [cursor, setCursor] = useState(''), [previous, setPrevious] = useState<string[]>([]), [blockedId, setBlockedId] = useState('');
  const list = useQuery({ queryKey: ['researchExports', user?.id, cursor], queryFn: ({ signal }) => fetchApi<ResearchExportListResponse>(`/v1/research-exports?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }), retry: false, enabled: Boolean(user) });
  const detail = useQuery({ queryKey: ['researchExport', user?.id, selected], queryFn: ({ signal }) => fetchApi<ResearchExportResponse>(`/v1/research-exports/${encodeURIComponent(selected)}`, { signal }), retry: false, enabled: Boolean(user && selected) });
  const remove = useMutation({ mutationFn: () => fetchApi<{ ok: true; deleted: true }>(`/v1/research-exports/${encodeURIComponent(selected)}`, { method: 'DELETE' }),
    onSuccess: () => { const next = new URLSearchParams(params); next.delete('research'); setParams(next); void client.invalidateQueries({ queryKey: ['researchExports', user?.id] }); client.removeQueries({ queryKey: ['researchExport', user?.id, selected] }); client.removeQueries({ queryKey: ['researchExportPage', user?.id, selected] }); setBlockedId(''); },
    onError: error => { if (error instanceof ApiError && error.code === 'audit_result_unknown') { setBlockedId(selected); void list.refetch(); void detail.refetch(); } },
  });
  return <section className="source-content-page content-research-saved" aria-labelledby="research-exports-title"><div><h2 id="research-exports-title">{copy('My research exports', '我的研究导出')}</h2><p className="content-muted">{copy('Private frozen snapshots for this account. Open content search to create a snapshot from applied filters. They stay fixed when public content or source configuration changes.', '当前账户的个人冻结快照。请在内容查询页按已应用筛选创建，公共内容或来源配置变化不会改变既有快照。')}</p><Link to="/content">{copy('Search and freeze content', '查询并冻结内容')}</Link></div>
    {list.isLoading && <p role="status">{copy('Loading research exports…', '正在读取研究导出…')}</p>}
    {list.error && <p role="alert" className="content-error">{list.error.message} <Button onClick={() => void list.refetch()}>{copy('Retry research exports', '重试研究导出')}</Button></p>}
    {list.data?.exports.length === 0 && <p>{copy('No research exports for this account.', '当前账户尚无研究导出。')}</p>}
    <ul className="content-saved-query-list">{list.data?.exports.map(view => <li key={view.id}><Link to={`/saved?research=${encodeURIComponent(view.id)}`} onClick={() => remove.reset()}>{view.name}</Link><p className="content-muted">{copy('Fixed sample total', '固定样本总数')} {view.total} · {new Date(view.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}</p></li>)}</ul>
    {(previous.length > 0 || list.data?.nextCursor) && <div className="content-pager"><Button disabled={!previous.length || list.isFetching} onClick={() => { setCursor(previous.at(-1) ?? ''); setPrevious(previous.slice(0, -1)); }}>{copy('Previous exports', '上一页导出')}</Button><Button disabled={!list.data?.nextCursor || list.isFetching} onClick={() => { setPrevious([...previous, cursor]); setCursor(list.data?.nextCursor ?? ''); }}>{copy('Next exports', '下一页导出')}</Button></div>}
    {selected && <div className="content-research-detail" key={selected}>
      {detail.isLoading && <p role="status">{copy('Loading export manifest…', '正在读取导出 manifest…')}</p>}
      {detail.error && <p role="alert" className="content-error">{detail.error.message} <Button onClick={() => void detail.refetch()}>{copy('Retry manifest', '重试 manifest')}</Button></p>}
      {detail.data && !detail.isError && <><h3>{detail.data.researchExport.name}</h3><ManifestView manifest={detail.data.researchExport.manifest} zh={zh} /><FrozenContentPages key={selected} view={detail.data.researchExport} zh={zh} /><div className="content-actions"><Button disabled={remove.isPending || blockedId === selected} onClick={() => { if (window.confirm(copy('Delete this frozen snapshot and its members? Download required files first.', '删除此冻结快照及其成员吗？请先下载需要保留的文件。'))) remove.mutate(); }}>{copy('Delete frozen export', '删除冻结导出')}</Button></div></>}
      {remove.error && <p role="alert" className="content-error">{remove.error.message}</p>}
      {blockedId === selected && <p role="alert">{copy('Deletion outcome is unknown. Inspect the refreshed list and manifest before retrying.', '删除结果未知，请先核对刷新的导出列表与 manifest，再决定是否重试。')}</p>}
    </div>}
  </section>;
}
