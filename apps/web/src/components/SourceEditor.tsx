import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { REDDIT_ARCHIVE_SOURCE_TAG, SourceGroupPattern, SourceLocalePattern } from '../../../../packages/contracts/src/source-content';
import { webBoards } from '../../../../packages/contracts/src/web-boards';
import { apiClient } from '../api/client';
import { formatApiError, useCreateSourceMutation, useUpdateSourceMutation } from '../api/hooks';
import { formatSourceTarget, type CollectionSource, type SourceCapability, type SourceInput, type SourcePatch, type SourceTarget } from '../contracts/api';
import { useI18n } from '../i18n/translations';

const platforms: SourceInput['platform'][] = ['web', 'reddit', 'x', 'bluesky'];
const pushTargets: SourceTarget['type'][] = ['search', 'community', 'account', 'post', 'feed'];
const pushKinds: SourceInput['contentKind'][] = ['post', 'comment', 'article', 'image', 'video'];
const targetFields = { search: 'query', community: 'community', account: 'account', post: 'postId', feed: 'url' } as const;
const targetLabels = {
  search: ['Search terms', '搜索词'], community: ['Subreddit', 'Reddit 版块'],
  account: ['Account handle', '账号名称'], post: ['Post ID', '帖子 ID'], feed: ['Public HTTPS URL', '公开 HTTPS 地址'],
} as const;
const targetExamples = { search: 'e.g. local models', community: 'LocalLLaMA', account: 'example', post: 'abc123', feed: 'https://example.com/feed.xml' };
const listFields = ['items', 'link', 'title', 'summary', 'publishedAt', 'author'] as const;
const scheduleFields = [
  ['intervalSeconds', 60, 86400, 'Interval (seconds)', '执行间隔（秒）'],
  ['cadenceSeconds', 120, 43200, 'Legacy interval (seconds)', '旧版调度间隔（秒）'],
  ['overlapSeconds', 0, 3600, 'Overlap (seconds)', '补采重叠（秒）'],
  ['initialLookbackHours', 1, 48, 'First lookback (hours)', '首次回溯（小时）'],
  ['maxCatchupHours', 1, 48, 'Catch-up limit (hours)', '最长补采窗口（小时）'],
  ['pageSize', 1, 100, 'Items per page', '每页条数'],
  ['maxPages', 1, 5, 'Pages per run', '每次最多页数'],
] as const;

function readText(fields: FormData, name: string) {
  return String(fields.get(name) ?? '').trim();
}

function readNumber(fields: FormData, name: string) {
  const value = readText(fields, name);
  return value ? Number(value) : undefined;
}

function availableFallback(
  capabilities: SourceCapability[], provider: string, target?: SourceTarget['type'], kind?: SourceInput['contentKind'],
): SourceInput['fallbackProvider'] {
  const fallback = provider === 'kaix' ? 'red_crawler' : provider === 'twitterapis' ? 'scrapebadger' : undefined;
  return capabilities.some(cap => cap.provider === fallback && cap.enabled &&
    (!target || cap.targetTypes.includes(target)) && (!kind || cap.contentKinds.includes(kind))) ? fallback : undefined;
}

export function SourceEditor({
  capabilities, source, preferredChannel, onClose, onSaved,
}: {
  capabilities: SourceCapability[];
  source?: CollectionSource;
  preferredChannel?: SourceCapability;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [platform, setPlatform] = useState<SourceInput['platform']>(source?.platform ?? preferredChannel?.platform ?? 'web');
  const [mode, setMode] = useState<SourceInput['deliveryMode']>(source?.deliveryMode ?? 'pull');
  const [provider, setProvider] = useState<string>(preferredChannel?.provider ?? '');
  const [targetType, setTargetType] = useState<SourceTarget['type']>('feed');
  const [kind, setKind] = useState<SourceInput['contentKind']>('article');
  const [targetValue, setTargetValue] = useState('');
  const [listFormat, setListFormat] = useState<'' | 'web_list' | 'json_list'>('');
  const [error, setError] = useState('');
  const preview = useMutation({ mutationFn: (input: SourceInput) => apiClient.previewSource(input) });
  const create = useCreateSourceMutation();
  const update = useUpdateSourceMutation();
  const busy = preview.isPending || create.isPending || update.isPending;
  const providers = capabilities.filter(cap => cap.platform === platform);
  const cap = providers.find(item => item.provider === provider && item.enabled) ??
    providers.find(item => item.enabled);
  const targets = mode === 'push' ? pushTargets : cap?.targetTypes ?? [];
  const kinds = mode === 'push' ? pushKinds : cap?.contentKinds ?? [];
  const target = targets.includes(targetType) ? targetType : targets[0];
  const contentKind = kinds.includes(kind) ? kind : kinds[0];
  const providerName = source?.primaryProvider ?? (mode === 'push' ? 'external_ingest' : cap?.provider);
  const fallback = availableFallback(capabilities, providerName ?? '', source?.target.type ?? target, source?.contentKind ?? contentKind);
  const archivedReddit = platform === 'reddit' && mode === 'push';

  function readMetadata(fields: FormData) {
    const tags = readText(fields, 'tags').split(/[\s,]+/).filter(Boolean);
    if (archivedReddit && fields.has('redditArchive')) tags.push(REDDIT_ARCHIVE_SOURCE_TAG);
    const schedule = {
      enabled: fields.has('scheduled'),
      ...Object.fromEntries(scheduleFields.map(([name]) => [name, readNumber(fields, name)]).filter(([, value]) => value !== undefined)),
    };
    return {
      label: readText(fields, 'label'),
      sourceGroup: readText(fields, 'sourceGroup') || null,
      tier: readText(fields, 'tier') as SourceInput['tier'],
      locale: readText(fields, 'locale') || null,
      ownerEntityId: readText(fields, 'ownerEntityId') || null,
      tags: [...new Set(tags)],
      schedule,
      fetchPolicy: mode === 'pull' && (providerName === 'feed' || providerName === 'newsnow') ? {
        maxItems: readNumber(fields, 'maxItems'),
        timeoutMs: readNumber(fields, 'timeoutMs'),
        stripTrackingParams: fields.has('stripTracking'),
        excludeTitlePatterns: readText(fields, 'excludeTitles').split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      } : source?.fetchPolicy,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const metadata = readMetadata(fields);
    setError('');
    try {
      const fallbackValue = (readText(fields, 'fallback') || undefined) as SourceInput['fallbackProvider'];
      if (source) {
        const hasScheduleChange = Object.entries(metadata.schedule).some(([key, value]) =>
          value !== source.schedule?.[key as keyof typeof source.schedule]) ||
          scheduleFields.some(([key]) => source.schedule?.[key] !== undefined && readNumber(fields, key) === undefined);
        const patch: SourcePatch = {
          ...metadata,
          schedule: mode === 'pull' && hasScheduleChange ? metadata.schedule : undefined,
          fallbackProvider: (fallbackValue ?? null) === source.fallbackProvider ? undefined : fallbackValue ?? null,
          revision: source.revision,
        };
        await update.mutateAsync({ id: source.id, input: patch });
        onSaved(source.id);
        return;
      }
      if (!providerName || !target || !contentKind) return;
      const value = readText(fields, 'target');
      const query = readText(fields, 'scopedQuery');
      const list = listFormat && target === 'feed' && providerName === 'feed' ? {
        format: listFormat,
        items: readText(fields, 'items'), link: readText(fields, 'link'), title: readText(fields, 'title'),
        summary: readText(fields, 'summary') || undefined,
        publishedAt: readText(fields, 'publishedAt') || undefined,
        author: readText(fields, 'author') || undefined,
      } : undefined;
      const input: SourceInput = {
        ...metadata,
        platform, deliveryMode: mode, contentKind,
        primaryProvider: providerName as SourceInput['primaryProvider'],
        fallbackProvider: fallbackValue,
        target: { type: target, [targetFields[target]]: value, ...(query && { query }), ...(list && { list }) } as SourceTarget,
      };
      if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'preview') {
        await preview.mutateAsync(input);
      } else {
        const result = await create.mutateAsync(input);
        onSaved(result.source.id);
      }
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  return (
    <dialog ref={dialog} className="sr-modal source-editor collection-dialog" aria-labelledby="source-editor-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="source-editor-header">
        <h3 id="source-editor-title">{source ? t('Edit source', '编辑来源') : t('Create Collection Source', '新建采集来源')}</h3>
        <button type="button" className="sr-btn sr-btn--subtle" aria-label={t('Close', '关闭')} onClick={onClose} disabled={busy}><X size={16} /></button>
      </header>
      <p className="collection-hint">{source
        ? t('Update classification, schedule or fetch settings for this source.', '可修改分类、调度和抓取设置。')
        : t('Choose how content arrives, then provide a target and name. Preview to check the configuration before saving.', '先选择接入方式，再填写目标和名称。保存前可用预览检查配置。')}</p>
      <form className="collection-form" onSubmit={submit} onChange={() => { if (preview.data) preview.reset(); }}>
        <fieldset className="source-editor-fields" disabled={busy}>
          {!source && (
            <>
              <div className="wb-grid-2">
                <label className="wb-field">{t('Collection mode', '接入方式')}
                  <select className="wb-select" aria-label={t('Collection mode', '接入方式')} value={mode} onChange={event => {
                    const next = event.target.value as typeof mode;
                    setMode(next);
                    setTargetType(next === 'push' ? 'search' : 'feed');
                    setKind(platform === 'web' ? 'article' : 'post');
                    setTargetValue('');
                  }}>
                    <option value="pull">{t('Pull via provider', '通过渠道主动采集')}</option><option value="push">{t('Push via API or JSON', '通过 API 或 JSON 推流')}</option>
                  </select>
                </label>
                <label className="wb-field">{t('Platform', '平台')}
                  <select className="wb-select" aria-label={t('Platform', '平台')} value={platform} onChange={event => {
                    const next = event.target.value as typeof platform;
                    setPlatform(next);
                    setKind(next === 'web' ? 'article' : 'post');
                    setProvider('');
                    setTargetValue('');
                  }}>
                    {platforms.map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
              </div>
              {mode === 'pull' && (
                <label className="wb-field">{t('Primary provider', '主渠道')}
                  <select className="wb-select" aria-label={t('Primary provider', '主渠道')} value={cap?.provider ?? ''} onChange={event => { setProvider(event.target.value); setTargetValue(''); }}>
                    {!cap && <option value="">{t('No ready provider', '当前无就绪渠道')}</option>}
                    {providers.map(item => <option value={item.provider} key={item.provider} disabled={!item.enabled}>{item.provider}{item.enabled ? '' : ' · ' + t('not ready', '未就绪')}</option>)}
                  </select>
                </label>
              )}
              {mode === 'pull' && !cap && <p className="muted">{t('Check service networking and provider credentials in Channels.', '请在渠道设置中检查服务联网与凭证。')}</p>}
              <div className="wb-grid-2">
                <label className="wb-field">{t('Target type', '目标类型')}
                  <select className="wb-select" aria-label={t('Target type', '目标类型')} value={target ?? ''} onChange={event => { setTargetType(event.target.value as typeof targetType); setTargetValue(''); }}>
                    {targets.map(value => <option key={value} value={value}>{t(targetLabels[value][0], targetLabels[value][1])}</option>)}
                  </select>
                </label>
                <label className="wb-field">{t('Content type', '内容类型')}
                  <select className="wb-select" value={contentKind ?? ''} onChange={event => setKind(event.target.value as typeof kind)}>
                    {kinds.map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
              </div>
              {target && (
                <label className="wb-field">{providerName === 'newsnow' ? t('NewsNow board', 'NewsNow 榜单') : t(targetLabels[target][0], targetLabels[target][1])}
                  {providerName === 'newsnow' ? (
                    <select className="wb-select" name="target" required>
                      {Object.entries(webBoards).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  ) : <input className="wb-input" name="target" required type={target === 'feed' ? 'url' : 'text'}
                    maxLength={{ search: 512, community: 100, account: 253, post: 100, feed: 2000 }[target]}
                    placeholder={targetExamples[target]} value={targetValue} onChange={event => setTargetValue(event.target.value)} />}
                </label>
              )}
              {mode === 'pull' && target && cap?.keywordSearch === 'global' && cap.provider === 'kaix' && !['feed', 'search'].includes(target) && (
                <label className="wb-field">{t('Optional target query', '目标内关键词（可选）')}<input name="scopedQuery" className="wb-input" maxLength={200} /></label>
              )}
              {providerName === 'feed' && target === 'feed' && (
                <>
                  <label className="wb-field">{t('Feed format', 'Feed 解析格式')}
                    <select className="wb-select" value={listFormat} onChange={event => setListFormat(event.target.value as typeof listFormat)}>
                      <option value="">RSS / Atom / HTML {t('discovery', '发现')}</option><option value="web_list">{t('HTML list (CSS selectors)', 'HTML 列表（CSS 选择器）')}</option><option value="json_list">{t('JSON list (dot paths)', 'JSON 列表（点路径）')}</option>
                    </select>
                  </label>
                  {listFormat && <p className="collection-hint">{listFormat === 'web_list'
                    ? t('Enter the CSS selector for each list item and the relative selectors for link and title.', '填写列表项的 CSS 选择器，再填相对于列表项的链接和标题选择器。')
                    : t('Enter the array path and the link and title paths within each item. Use $ for a root array.', '填写数组路径及每条记录内的链接和标题路径。根节点是数组时填写 $。')}</p>}
                  {listFormat && <div className="wb-grid-2">{listFields.map((name, index) => (
                    <label className="wb-field" key={name}>{name}<input className="wb-input" name={name} placeholder={listFormat === 'web_list' ? ['article', 'a', 'h2', 'p', 'time', '.author'][index] : ['items', 'url', 'title', 'summary', 'publishedAt', 'author'][index]} maxLength={160} required={index < 3} /></label>
                  ))}</div>}
                </>
              )}
            </>
          )}
          {source && <p className="muted">{formatSourceTarget(source.target)} · {t('To change the target, create a replacement source and archive this one.', '如需更换目标，请新建来源后归档当前来源。')}</p>}
          <label className="wb-field">{t('Source name', '来源名称')}<input name="label" className="wb-input" required maxLength={100} defaultValue={source?.label} /></label>
          <div className="wb-grid-2">
            <label className="wb-field">{t('Source group', '来源分类')}<input name="sourceGroup" className="wb-input" pattern={SourceGroupPattern.replaceAll('_-', '_\\-')} defaultValue={source?.sourceGroup ?? ''} /></label>
            <label className="wb-field">{t('Source tier', '来源等级')}<select name="tier" className="wb-select" defaultValue={source?.tier ?? 'T2'}><option>T1</option><option>T1_5</option><option>T2</option></select></label>
            <label className="wb-field">{t('Locale (e.g. zh-CN)', '语言区域（如 zh-CN）')}<input name="locale" className="wb-input" pattern={SourceLocalePattern} defaultValue={source?.locale ?? ''} /></label>
            <label className="wb-field">{t('Owner entity slug', '归属实体标识')}<input name="ownerEntityId" className="wb-input" defaultValue={source?.ownerEntityId ?? ''} /></label>
          </div>
          <label className="wb-field">{t('Tags (comma or space separated)', '标签（逗号或空格分隔）')}
            <input name="tags" className="wb-input" defaultValue={source?.tags.filter(tag => !archivedReddit || tag !== REDDIT_ARCHIVE_SOURCE_TAG).join(', ')} />
          </label>
          {archivedReddit && <label><input name="redditArchive" type="checkbox" defaultChecked={source?.tags.includes(REDDIT_ARCHIVE_SOURCE_TAG)} /> {t('Reddit offline archive (R4)', 'Reddit 离线归档（R4）')}</label>}
          {mode === 'pull' && (
            <>
              {(fallback || source?.fallbackProvider) && (
                <label className="wb-field" key={providerName}>{t('Fallback provider', '备援渠道')}
                  <select name="fallback" className="wb-select" defaultValue={source?.fallbackProvider ?? ''}>
                    <option value="">{t('None', '无')}</option>
                    {source?.fallbackProvider && source.fallbackProvider !== fallback && <option value={source.fallbackProvider}>{source.fallbackProvider} · {t('not ready', '未就绪')}</option>}
                    {fallback && <option value={fallback}>{fallback}</option>}
                  </select>
                </label>
              )}
              {providerName === 'kaix' && fallback && <p className="muted">{t('Both Reddit channels use Apify and share its credential and availability.', '两个 Reddit 渠道均使用 Apify，共用凭证并受其可用性影响。')}</p>}
              {capabilities.some(item => item.provider === providerName && item.automaticRequestReplay === false) &&
                <p className="muted">{t('Automatic runs may use paid provider resources within the configured system budget.', '自动调度可能在系统渠道预算内使用付费资源。')}</p>}
              <label><input name="scheduled" type="checkbox" defaultChecked={source?.schedule?.enabled ?? false} /> {t('Enable automatic scheduling', '启用自动调度')}</label>
              <details className="collection-disclosure">
                <summary>{t('Schedule settings (blank uses server defaults)', '调度参数（留空使用服务端默认值）')}</summary>
                <p className="collection-hint">{t('The default interval is 3,600 seconds. An explicit interval takes precedence over the legacy value.', '默认每 3,600 秒执行一次。填写执行间隔后，优先于旧版调度间隔。')}</p>
                <div className="wb-grid-2">{scheduleFields.filter(([name]) => name !== 'cadenceSeconds' || source?.schedule?.cadenceSeconds !== undefined).map(([name, min, max, en, zh]) => (
                  <label className="wb-field" key={name}>{t(en, zh)}<input name={name} className="wb-input" type="number" min={min} max={max} defaultValue={source?.schedule?.[name]} /></label>
                ))}</div>
              </details>
              {(providerName === 'feed' || providerName === 'newsnow') && (
                <details className="collection-disclosure">
                  <summary>{t('Fetch policy', '抓取策略')}</summary>
                  <p className="collection-hint">{t('These settings apply to individual provider fetches. Leave numeric fields blank to use server defaults.', '这些参数作用于单次渠道抓取。数字留空采用服务端默认值。')}</p>
                  <div className="wb-grid-2">
                    <label className="wb-field">{t('Maximum items per fetch', '单次抓取最多条数')}<input name="maxItems" className="wb-input" type="number" min={1} max={100} defaultValue={source?.fetchPolicy.maxItems} /></label>
                    <label className="wb-field">{t('Fetch timeout (ms)', '抓取超时（毫秒）')}<input name="timeoutMs" className="wb-input" type="number" min={3000} max={15000} defaultValue={source?.fetchPolicy.timeoutMs} /></label>
                  </div>
                  <label><input name="stripTracking" type="checkbox" defaultChecked={source?.fetchPolicy.stripTrackingParams !== false} /> {t('Strip tracking parameters', '移除跟踪参数')}</label>
                  <label className="wb-field">{t('Title exclusions (one per line)', '排除标题（每行一条）')}<textarea name="excludeTitles" className="wb-input" defaultValue={source?.fetchPolicy.excludeTitlePatterns?.join('\n')} /></label>
                </details>
              )}
            </>
          )}
        </fieldset>
        {error && <div role="alert" className="wb-alert wb-alert--error">{error}</div>}
        {preview.data && <section className="wb-alert wb-alert--info collection-form" role="status">
          <p>{preview.data.mode === 'fetched' ? t('Fetched preview', '已试抓预览') : t('Configuration validated', '配置已校验')} · {preview.data.providerEnabled ? t('provider ready', '渠道就绪') : t('provider unavailable', '渠道未就绪')} · {formatSourceTarget(preview.data.target)}</p>
          {preview.data.items.length > 0 && <ul>{preview.data.items.map((item, index) => <li key={index}>{item.title ?? item.url ?? '—'}</li>)}</ul>}
          {preview.data.feeds.length > 0 && <ul>{preview.data.feeds.map(url => <li key={url}><button className="ds-btn ds-btn--ghost" type="button" onClick={() => { setTargetValue(url); preview.reset(); }}>{url}</button></li>)}</ul>}
        </section>}
        <footer className="source-editor-header">
          <button className="ds-btn ds-btn--ghost" type="button" onClick={onClose} disabled={busy}>{t('Cancel', '取消')}</button>
          {!source && <button className="ds-btn ds-btn--ghost" type="submit" value="preview" disabled={busy || !providerName}>{preview.isPending ? t('Checking…', '正在校验…') : t('Preview source', '预览来源')}</button>}
          <button className="ds-btn" type="submit" value="save" disabled={busy || !providerName}>{source ? t('Save source', '保存来源') : t('Create Source', '创建来源')}</button>
        </footer>
      </form>
    </dialog>
  );
}
