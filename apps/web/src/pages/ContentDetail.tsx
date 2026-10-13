import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Button } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
import { safeInternalReturnPath } from '../auth/internalReturnPath';
import { safeContentUrl } from '../features/content/queryState';
import { ContentAnnotation } from '../features/content/ContentAnnotation';
import type { ContentDetailResponse, ContentMedia, PublicContent, SourceListResponse } from '../../../../packages/contracts/src/source-content';
import './Content.css';

function StoredMedia({ media, zh }: { media: ContentMedia; zh: boolean }) {
  const [opened, setOpened] = useState(false), [failed, setFailed] = useState(false);
  const copy = (en: string, cn: string) => zh ? cn : en;
  const url = safeContentUrl(media.url);
  return <li className="content-media-item">
    <p>{media.type} · {media.durationSeconds === null ? copy('Duration unknown', '时长未知') : `${media.durationSeconds}s`}</p>
    {media.altText && <p>{media.altText}</p>}
    {!url ? <p>{copy('Media address is missing or unsafe.', '媒体地址缺失或无法安全打开。')}</p> : <>
      <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{copy('Open media address', '打开媒体地址')}</a>
      {media.type !== 'link' && !opened && <Button type="button" onClick={() => setOpened(true)}>{copy('Load media preview', '加载媒体预览')}</Button>}
      {opened && <><Button type="button" onClick={() => setOpened(false)}>{copy('Hide media preview', '隐藏媒体预览')}</Button>
        {failed ? <p role="status">{copy('Media could not be loaded. It may have expired or be unavailable.', '媒体无法加载，可能已过期或不可访问。')}</p>
          : media.type === 'image' ? <img src={url} alt={media.altText ?? copy('Source image; description unavailable', '来源图片，描述未知')} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
            : media.type === 'video' ? <video controls preload="none" src={url} onError={() => setFailed(true)} aria-label={media.altText ?? copy('Source video', '来源视频')} />
              : media.type === 'audio' ? <audio controls preload="none" src={url} onError={() => setFailed(true)} aria-label={media.altText ?? copy('Source audio', '来源音频')} /> : null}
      </>}
    </>}
  </li>;
}

export function ContentDetail() {
  const { contentId = '' } = useParams(), [params] = useSearchParams();
  const { language } = useLanguage(), zh = language === 'zh-CN';
  const copy = (en: string, cn: string) => zh ? cn : en;
  const back = safeInternalReturnPath(params.get('back'));
  const detail = useQuery({ queryKey: ['contentDetail', contentId], queryFn: ({ signal }) => fetchApi<ContentDetailResponse>(`/v1/content/${encodeURIComponent(contentId)}`, { signal }), retry: false });
  const sources = useQuery({ queryKey: ['contentSources'], queryFn: ({ signal }) => fetchApi<SourceListResponse>('/v1/sources', { signal }), retry: false });
  const item = detail.data?.content;
  const time = (value: string | null) => value ? `${new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US')} · ${value}` : copy('Unknown', '未知');
  const relatedLink = (content: PublicContent) => <Link to={`/content/${encodeURIComponent(content.id)}?back=${encodeURIComponent(back)}`}>{content.title || content.text?.slice(0, 100) || `${content.kind} · ${content.externalId}`}</Link>;
  const original = safeContentUrl(item?.url), authorUrl = safeContentUrl(item?.author?.url);
  return <div className="source-content-page content-detail-page">
    <Link to={back}>{back.startsWith('/saved') ? copy('Back to saved items', '返回保存项') : copy('Back to content query', '返回内容查询')}</Link>
    {detail.isLoading && <p role="status">{copy('Loading stored content…', '正在读取已存内容…')}</p>}
    {detail.error && <p role="alert" className="content-error">{detail.error.message} <Button onClick={() => void detail.refetch()}>{copy('Retry detail', '重试详情')}</Button></p>}
    {item && detail.data && <>
      <header className="content-heading"><div className="content-meta"><span>{item.platform} · {item.kind}</span><span>{item.availability}</span>{item.observations.some(observation => observation.provider.startsWith('demo_')) && <strong>{copy('SYNTHETIC DEMO', '合成演示')}</strong>}</div><h1>{item.title || copy('Stored content detail', '已存内容详情')}</h1>
        <p>{copy('Identity', '内容身份')}: {item.externalId} · {copy('Language', '语言')}: {item.language ?? copy('Unknown', '未知')}</p>
        {original ? <a href={original} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{copy('Open original', '打开原链接')}</a> : <p className="content-muted">{copy('Original link unavailable.', '原链接未知或不可安全打开。')}</p>}
      </header>
      <section aria-labelledby="content-body-title"><h2 id="content-body-title">{copy('Content and publication', '内容与发布时间')}</h2>
        {item.text ? <p className="content-text">{item.text}</p> : <p className="content-muted">{copy('Text was not provided; missing text is not an empty source post.', '来源未提供正文，缺失正文不表示源内容为空。')}</p>}
        {['deleted', 'removed'].includes(item.availability) && <p>{copy('The source reports removed or deleted content. Stored fields reflect the retained observation.', '源内容已删除或移除，当前字段来自保留的观测。')}</p>}
        <dl className="content-detail-fields"><dt>{copy('Author', '作者')}</dt><dd>{item.author?.displayName ?? item.author?.handle ?? copy('Unknown', '未知')}{item.author?.handle && ` · ${item.author.handle}`}{item.author?.externalId && ` · ID ${item.author.externalId}`}{authorUrl && <> · <a href={authorUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{copy('Author link', '作者链接')}</a></>}</dd>
          <dt>{copy('Published', '发布')}</dt><dd>{time(item.publishedAt)}</dd><dt>{copy('First fetched', '首次取回')}</dt><dd>{time(item.firstFetchedAt)}</dd><dt>{copy('Last fetched', '最近取回')}</dt><dd>{time(item.lastFetchedAt)}</dd></dl>
        <p className="content-muted">{copy('Publication and fetch times differ. An unknown source observation time cannot be inferred from the fetch time.', '发布时间与取回时间不同；源观测时间未知时，不能用取回时间替代。')}</p>
      </section>
      <section aria-labelledby="content-media-title"><h2 id="content-media-title">{copy('Media', '媒体')}</h2><p className="content-muted">{copy('Media stays unloaded until you request a preview. Loading or opening it may contact the media host. Links can expire; no remote content lookup is performed.', '媒体默认不加载，主动预览或打开链接时会访问媒体所在主机。链接可能失效；此页不进行远端内容补查。')}</p>
        {item.media.length === 0 ? <p>{copy('No media was supplied.', '未提供媒体。')}</p> : <ul className="content-media-list">{item.media.map((media, index) => <StoredMedia key={`${item.id}:${index}:${media.url}`} media={media} zh={zh} />)}</ul>}
      </section>
      <section aria-labelledby="content-observations-title"><h2 id="content-observations-title">{copy('Source observations and metrics', '来源观测与指标')}</h2>
        {item.observations.length === 0 && <p>{copy('No metric observations are stored.', '尚未保存指标观测。')}</p>}
        {item.observations.map(observation => { const source = detail.data!.sources.find(value => value.id === observation.sourceId); const capability = sources.data?.capabilities.find(value => value.provider === observation.provider && value.platform === item.platform); return <article className="content-observation-detail" key={`${observation.sourceId}:${observation.fetchedAt}`}>
          <h3>{source?.label ?? observation.sourceId} · {observation.provider}</h3>
          <dl className="content-detail-fields"><dt>{copy('Source time basis', '来源时间依据')}</dt><dd>{observation.timeBasis} · {observation.maturity}</dd><dt>{copy('Source observation time', '源观测时间')}</dt><dd>{time(observation.sourceObservedAt)}</dd><dt>{copy('Fetched', '取回')}</dt><dd>{time(observation.fetchedAt)}</dd><dt>{copy('Evidence key', '证据标识')}</dt><dd>{observation.evidenceKey}</dd></dl>
          <ul className="content-metric-list">{Object.entries(observation.metrics).map(([key, value]) => { const definition = capability?.metrics.find(metric => metric.key === key); return <li key={key}><strong>{definition?.label ?? key}</strong> · {key}: <span>{value === null ? copy('Unknown', '未知') : String(value)}</span> · {copy('Unit', '单位')}: {definition?.unit ?? copy('Unknown', '未知')}{definition && ` · ${definition.cumulative ? copy('Cumulative', '累计') : copy('Non-cumulative', '非累计')}`}</li>; })}</ul>
          {Object.keys(observation.metrics).length === 0 && <p className="content-muted">{copy('No metrics supplied.', '未提供指标。')}</p>}
        </article>; })}
        <p className="content-muted">{copy('Null means unknown; zero is a reported value. Platform metric units stay separate. A single snapshot is not a growth rate or full-platform ranking.', 'null 表示未知，0 表示已报告的零值。各平台指标保留各自单位，单次快照不表示增长率或平台全量排名。')}</p>
        {sources.error && <p className="content-muted">{copy('Metric definitions could not be loaded; units above remain unknown where unavailable.', '指标定义暂时无法读取，无法确认的单位保留为未知。')}</p>}
      </section>
      <section aria-labelledby="content-related-title"><h2 id="content-related-title">{copy('Stored references and replies', '已存引用与回复')}</h2>
        <p className="content-muted">{copy(`Only stored content is shown. Each reference/reply list is bounded to ${detail.data.relatedLimit} items. Missing references do not trigger a provider request.`, `仅展示已保存内容，引用与回复列表各自上限 ${detail.data.relatedLimit} 条，缺失引用不会触发 provider 请求。`)}</p>
        <ul>{detail.data.references.map(({ reference, content }, index) => <li key={`${reference.relation}:${reference.externalId}:${index}`}>{reference.relation} · {reference.kind} · {reference.externalId} · {content ? relatedLink(content) : copy('Referenced content not stored', '引用内容尚未保存')}</li>)}</ul>
        {detail.data.references.length === 0 && <p>{copy('No references supplied.', '未提供引用。')}</p>}
        <h3>{copy('Stored replies', '已存回复')}</h3><ul>{detail.data.children.map(child => <li key={child.id}>{relatedLink(child)}</li>)}</ul>
        {detail.data.children.length === 0 && <p>{copy('No replies stored in this bounded view.', '此有界视图中没有已存回复。')}</p>}
        {detail.data.relatedTruncated && <p role="note">{copy('More stored related items exist beyond this view’s limit.', '另有已存关联项超出当前视图上限。')}</p>}
      </section>
      <details><summary>{copy('Platform fields and retained extensions', '平台字段与保留扩展')}</summary><p className="content-muted">{copy('Platform-specific fields stay distinct; null fields remain unknown. Extensions contain retained allowlisted metadata.', '平台专属字段分别保留，null 字段仍表示未知；扩展仅为保留的白名单元数据。')}</p><pre className="content-platform-fields">{JSON.stringify(item.platformDetails, null, 2)}</pre></details>
      <ContentAnnotation key={item.id} contentId={item.id} zh={zh} />
    </>}
  </div>;
}
