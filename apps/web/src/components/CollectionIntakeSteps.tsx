import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Info, Sparkles, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert } from './ui/alert';
import { Checkbox } from './ui/checkbox';
import {
  formatSourceTarget,
  type CollectionSource,
  type QueryHintsValue,
  type ResearchCollectionRestriction,
  type ResearchPlanPreviewRequest,
  type ResearchPlanPreviewResponse,
} from '../contracts/api';
import { getRangeLimits } from '../lib/researchIntake';
import { useI18n } from '../i18n/translations';

export type ManualTarget = {
  platform: NonNullable<ResearchPlanPreviewRequest['platform']>;
  targetType: NonNullable<ResearchPlanPreviewRequest['targetType']>;
  targetValue: string;
};
export type IntakeTarget = { sourceId: string } | ManualTarget;
export type CollectionRange = {
  days: number;
  limit: number;
  comments: boolean;
  commentLimit: number;
  fallback: boolean;
  queryHints: QueryHintsValue;
};
export type CollectionEstimate = {
  request: ResearchPlanPreviewRequest;
  result: ResearchPlanPreviewResponse;
  key: string;
  expiresAt: number;
};

type PlatformKey = ManualTarget['platform'];
type TargetTypeKey = ManualTarget['targetType'];

const PLATFORM_META: Record<
  PlatformKey,
  {
    name: string;
    provider: string;
    types: readonly TargetTypeKey[];
    badgeEn: string;
    badgeZh: string;
    descEn: string;
    descZh: string;
  }
> = {
  reddit: {
    name: 'Reddit',
    provider: 'kaix',
    types: ['community', 'account', 'search'],
    badgeEn: 'Communities · Posts & Comments',
    badgeZh: '社区主帖 · 支持深度评论',
    descEn: 'Collect posts & comments from Subreddits, authors, or global Reddit search.',
    descZh: '支持采集指定 Subreddit 版块、作者主页或全站关键词讨论，支持附带评论。',
  },
  x: {
    name: 'X (Twitter)',
    provider: 'twitterapis',
    types: ['search', 'account'],
    badgeEn: 'Real-time · Up to 20 per run',
    badgeZh: '实时推文 · 支持精细过滤',
    descEn: 'Search keywords with boolean logic or monitor public X account timelines.',
    descZh: '支持关键词布尔检索或追踪公开 X 账号动态，支持点赞/回复门槛与去转发。',
  },
  bluesky: {
    name: 'Bluesky',
    provider: 'bluesky_appview',
    types: ['account'],
    badgeEn: 'Open Social · Handle Timeline',
    badgeZh: '开放网络 · 账号动态',
    descEn: 'Collect public posts from Bluesky accounts by domain handle or DID.',
    descZh: '通过完整域名 Handle 或 DID 采集 Bluesky 公开账号发帖。',
  },
};

const TYPE_META: Record<
  TargetTypeKey,
  {
    labelEn: string;
    labelZh: string;
    descEn: string;
    descZh: string;
  }
> = {
  community: {
    labelEn: 'Community / Subreddit',
    labelZh: '社区版块',
    descEn: 'Track posts inside one specific community space.',
    descZh: '按单个社区版块名称抓取帖子与热议。',
  },
  account: {
    labelEn: 'Account / Author',
    labelZh: '指定账号',
    descEn: 'Follow original posts published by one account.',
    descZh: '追踪单个公开账号或官方号发布的内容。',
  },
  search: {
    labelEn: 'Keyword Search',
    labelZh: '关键词检索',
    descEn: 'Discover matching posts across the platform.',
    descZh: '按产品词、竞品词或组合表达式检索讨论。',
  },
};

type TargetGuide = {
  placeholder: string;
  prefix?: string;
  allowedZh: string;
  allowedEn: string;
  disallowedZh: string;
  disallowedEn: string;
  examples: string[];
  validate: (raw: string) => { valid: boolean; reasonZh?: string; reasonEn?: string };
};

function getTargetGuide(platform: PlatformKey, targetType: TargetTypeKey): TargetGuide {
  if (platform === 'reddit' && targetType === 'community') {
    return {
      placeholder: 'r/LocalLLaMA',
      prefix: 'r/',
      allowedZh: '单个 Subreddit 名称（可带或不带 r/），2–40 位字母、数字或下划线/连字符。',
      allowedEn: 'One subreddit name (with or without r/), 2–40 letters, digits, _ or -.',
      disallowedZh: '不支持完整网页 URL（https://...）、空格、中文或逗号分隔多个社区。',
      disallowedEn: 'Do not enter full URLs, spaces, or multiple comma-separated communities.',
      examples: ['r/LocalLLaMA', 'r/ClaudeAI', 'r/SaaS'],
      validate: (raw) => {
        const cleaned = raw.trim().replace(/^r\//i, '');
        if (!cleaned) return { valid: false };
        if (/^https?:\/\//i.test(raw) || cleaned.includes('/')) {
          return {
            valid: false,
            reasonZh: '请勿输入完整链接或多余斜杠，直接填写版块名即可（如 LocalLLaMA 或 r/LocalLLaMA）。',
            reasonEn: 'Enter only the subreddit slug (e.g. LocalLLaMA), not a full URL.',
          };
        }
        if (!/^[a-z0-9_-]{2,40}$/i.test(cleaned)) {
          return {
            valid: false,
            reasonZh: 'Subreddit 名称须为 2–40 位英文字符、数字、下划线或连字符，不能含空格或逗号。',
            reasonEn: 'Must be 2–40 characters using letters, digits, underscores, or hyphens.',
          };
        }
        return { valid: true };
      },
    };
  }
  if (platform === 'reddit' && targetType === 'account') {
    return {
      placeholder: 'u/spez',
      prefix: 'u/',
      allowedZh: '单个 Reddit 用户名（可带或不带 u/），2–40 位字母、数字、下划线或连字符。',
      allowedEn: 'One Reddit username (with or without u/), 2–40 letters, digits, _ or -.',
      disallowedZh: '不支持个人主页链接、@ 符号、空格或一次填写多个账号。',
      disallowedEn: 'No profile URLs, @ prefix, spaces, or multiple accounts.',
      examples: ['spez', 'u/AutoModerator'],
      validate: (raw) => {
        const cleaned = raw.trim().replace(/^u\//i, '');
        if (!cleaned) return { valid: false };
        if (/^https?:\/\//i.test(raw) || cleaned.includes('/') || raw.startsWith('@')) {
          return {
            valid: false,
            reasonZh: '请仅输入 Reddit 用户名（如 spez 或 u/spez），不要包含链接或 @。',
            reasonEn: 'Enter only the Reddit username (e.g. spez), without URLs or @.',
          };
        }
        if (!/^[a-z0-9_-]{2,40}$/i.test(cleaned)) {
          return {
            valid: false,
            reasonZh: '用户名须为 2–40 位字母、数字、下划线或连字符。',
            reasonEn: 'Username must be 2–40 characters (letters, digits, _ or -).',
          };
        }
        return { valid: true };
      },
    };
  }
  if (platform === 'reddit' && targetType === 'search') {
    return {
      placeholder: 'local llm OR ollama',
      allowedZh: '搜索词或短语（1–200 字符），支持空格、引号短语或 OR 组合。',
      allowedEn: 'Search query (1–200 characters), supporting phrases and OR keywords.',
      disallowedZh: '不支持超过 200 字符、换行多行输入或直接粘贴网页 URL 抓取。',
      disallowedEn: 'Do not exceed 200 characters, include newlines, or paste URLs.',
      examples: ['AI coding assistant', '"local LLM" inference', 'ChatGPT OR Claude'],
      validate: (raw) => {
        const v = raw.trim();
        if (!v) return { valid: false };
        if (v.length > 200) {
          return {
            valid: false,
            reasonZh: 'Reddit 搜索词最长支持 200 个字符，请精简关键词。',
            reasonEn: 'Reddit search query must be 200 characters or fewer.',
          };
        }
        if (/^https?:\/\//i.test(v)) {
          return {
            valid: false,
            reasonZh: '请输入研究关键词，而不是网页 URL。',
            reasonEn: 'Enter search keywords, not a web URL.',
          };
        }
        return { valid: true };
      },
    };
  }
  if (platform === 'x' && targetType === 'account') {
    return {
      placeholder: '@OpenAI',
      prefix: '@',
      allowedZh: '单个 X (Twitter) Handle（可带或不带 @），仅限 1–15 位英文字母、数字或下划线。',
      allowedEn: 'One X handle (with or without @), 1–15 letters, digits, or underscores.',
      disallowedZh: '不支持个人昵称（如带空格的显示名）、x.com 网址链接或多账号列表。',
      disallowedEn: 'Do not use display names with spaces, x.com URLs, or multiple handles.',
      examples: ['@OpenAI', '@AnthropicAI', '@karpathy'],
      validate: (raw) => {
        const cleaned = raw.trim().replace(/^@/, '');
        if (!cleaned) return { valid: false };
        if (/^https?:\/\//i.test(raw) || raw.includes('/')) {
          return {
            valid: false,
            reasonZh: '请勿粘贴 x.com 主页链接，直接填写 @用户名 Handle 即可（如 @OpenAI）。',
            reasonEn: 'Paste only the @handle (e.g. @OpenAI), not the full x.com URL.',
          };
        }
        if (!/^[a-z0-9_]{1,15}$/i.test(cleaned)) {
          return {
            valid: false,
            reasonZh: 'X 账号 Handle 仅支持 1–15 位字母、数字或下划线（不能是带空格的昵称）。',
            reasonEn: 'X handles allow 1–15 letters, numbers, or underscores only.',
          };
        }
        return { valid: true };
      },
    };
  }
  if (platform === 'x' && targetType === 'search') {
    return {
      placeholder: 'ChatGPT OR Gemini',
      allowedZh: '支持关键词、引号精确短语与布尔语法（OR / -排除词），最长 512 字符。',
      allowedEn: 'Supports keywords, quoted phrases, and boolean logic (OR / -exclude), up to 512 chars.',
      disallowedZh: '建议避免粘贴完整 URL 或超过 512 字符的冗长查询；换行内容会被拒绝。',
      disallowedEn: 'Avoid raw URLs, newlines, or queries longer than 512 characters.',
      examples: ['ChatGPT OR Gemini', '"AI agent" workflow', 'Cursor IDE -hiring'],
      validate: (raw) => {
        const v = raw.trim();
        if (!v) return { valid: false };
        if (v.length > 512) {
          return {
            valid: false,
            reasonZh: 'X 搜索表达式不能超过 512 个字符。',
            reasonEn: 'X search query must be 512 characters or fewer.',
          };
        }
        if (/^https?:\/\//i.test(v)) {
          return {
            valid: false,
            reasonZh: '请输入检索关键词表达式，而非直接粘贴推文链接。',
            reasonEn: 'Enter a keyword search expression rather than a tweet URL.',
          };
        }
        return { valid: true };
      },
    };
  }
  return {
    placeholder: 'jay.bsky.social',
    prefix: '@',
    allowedZh: '完整 Bluesky 域名 Handle（如 jay.bsky.social）或 did:plc:... 标识符。',
    allowedEn: 'Full Bluesky domain handle (e.g. jay.bsky.social) or did:... identifier.',
    disallowedZh: '不能输入不带域名后缀的单词（如仅输入 jay）、网页 URL 或搜索词。',
    disallowedEn: 'Must include domain suffix (e.g. .bsky.social) or valid DID; no URLs.',
    examples: ['jay.bsky.social', 'bsky.app'],
    validate: (raw) => {
      const cleaned = raw.trim().replace(/^@/, '');
      if (!cleaned) return { valid: false };
      if (/^https?:\/\//i.test(raw) || raw.includes('/')) {
        return {
          valid: false,
          reasonZh: '请勿粘贴 bsky.app 主页链接，只需填写完整域名 Handle（如 jay.bsky.social）。',
          reasonEn: 'Enter only the domain handle (e.g. jay.bsky.social), not a web URL.',
        };
      }
      const isDid = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]{1,200}$/.test(cleaned);
      const isDomainHandle =
        cleaned.length <= 253 &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(cleaned);
      if (!isDid && !isDomainHandle) {
        return {
          valid: false,
          reasonZh: 'Bluesky 账号须包含完整域名后缀（如 jay.bsky.social）或以 did: 开头。',
          reasonEn: 'Bluesky handle must include a domain suffix (e.g. jay.bsky.social) or DID.',
        };
      }
      return { valid: true };
    },
  };
}

export function IntakeTargetStep({
  allowedProviders,
  restrictedSources,
  draft,
  setDraft,
  selectedSourceId,
  pending,
  onSelect,
}: {
  allowedProviders?: readonly string[];
  restrictedSources?: CollectionSource[];
  draft: ManualTarget;
  setDraft: (value: ManualTarget) => void;
  selectedSourceId: string | undefined;
  pending: boolean;
  onSelect: (target: IntakeTarget) => void;
}) {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState(selectedSourceId ?? '');

  // Only when Ops policy explicitly locked the account to a source whitelist (`allowedSourceIds !== null`),
  // render the allowlisted target picker. Otherwise everyone gets the unified self-service collection form.
  if (restrictedSources) {
    const needle = search.trim().toLocaleLowerCase();
    const visible = restrictedSources.filter((source) =>
      [source.label, formatSourceTarget(source.target), PLATFORM_META[source.platform as PlatformKey]?.name ?? source.platform]
        .some((value) => value.toLocaleLowerCase().includes(needle)),
    );
    return (
      <>
        <div>
          <h2>{t('Choose from allowed targets', '选择授权采集对象')}</h2>
          <p>
            {t(
              'Your account quota policy restricts new collections to specific approved targets.',
              '当前账号受运维配额策略限制，仅可从以下授权白名单对象中发起单次新采集。',
            )}
          </p>
        </div>
        <form
          className="intake-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending && restrictedSources.some((s) => s.id === sourceId)) {
              onSelect({ sourceId });
            }
          }}
        >
          <label className="wb-field">
            {t('Filter allowed targets', '筛选授权对象')}
            <Input
              type="search"
              value={search}
              placeholder={t('Search by label, platform, or target…', '按名称、平台或目标标识筛选…')}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="intake-target-list">
            {visible.length === 0 && (
              <p role="status" className="collection-hint">
                {restrictedSources.length
                  ? t('No targets match this search.', '没有符合搜索的授权对象。')
                  : t('No collection targets available under current policy.', '当前策略下暂无可发起采集的白名单对象。')}
              </p>
            )}
            {visible.map((source) => (
              <label key={source.id} className="intake-target-row">
                <input
                  type="radio"
                  name="intake-source"
                  value={source.id}
                  checked={sourceId === source.id}
                  onChange={() => setSourceId(source.id)}
                />
                <span>
                  <strong>{source.label}</strong>
                  <small>
                    {PLATFORM_META[source.platform as PlatformKey]?.name ?? source.platform} · {formatSourceTarget(source.target)}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="intake-actions">
            <Button type="submit" disabled={pending || !sourceId} className="intake-primary">
              {pending ? t('Checking availability…', '正在检查可用性…') : t('Continue to scope', '继续设置采集范围')}
              <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      </>
    );
  }

  const guide = getTargetGuide(draft.platform, draft.targetType);
  const rawValue = draft.targetValue.trim();
  const validation = rawValue ? guide.validate(rawValue) : { valid: false };
  const isPlatformPermitted = (p: PlatformKey) =>
    !allowedProviders || allowedProviders.includes(PLATFORM_META[p].provider);

  return (
    <>
      <div>
        <h2>{t('1. Define what new data to collect', '1. 定义要新采集的研究目标')}</h2>
        <p>
          {t(
            'Pick a platform, choose a target mode, and enter the exact community, account, or keywords to collect fresh data.',
            '选择目标平台与采集模式后填写精确目标内容，系统将预检可行性与预计额度消耗；已有数据复用或共享数据引入请前往「数据批次」。',
          )}
        </p>
      </div>

      <form
        className="intake-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || !validation.valid) return;
          onSelect({ ...draft, targetValue: rawValue });
        }}
      >
        <fieldset className="intake-fields" disabled={pending}>
          {/* 1. Platform Cards (Zero dropdowns) */}
          <div className="intake-section-block">
            <div className="intake-field-label">{t('Platform', '选择采集平台')}</div>
            <div className="intake-card-grid intake-card-grid--3" role="radiogroup" aria-label={t('Platform', '选择采集平台')}>
              {(['reddit', 'x', 'bluesky'] as const).map((platform) => {
                const meta = PLATFORM_META[platform];
                const permitted = isPlatformPermitted(platform);
                const selected = draft.platform === platform;
                return (
                  <button
                    key={platform}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!permitted}
                    className={`intake-choice-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => {
                      const nextType = meta.types.includes(draft.targetType) ? draft.targetType : meta.types[0];
                      setDraft({ platform, targetType: nextType, targetValue: '' });
                    }}
                  >
                    <div className="intake-choice-top">
                      <strong>{meta.name}</strong>
                      <span className={`tag ${permitted ? (selected ? 'tag--mint' : '') : 'tag--line'}`} style={{ fontSize: 10 }}>
                        {permitted ? t(meta.badgeEn, meta.badgeZh) : t('Restricted by policy', '策略未开放')}
                      </span>
                    </div>
                    <small>{t(meta.descEn, meta.descZh)}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Target Type Cards (Zero dropdowns) */}
          <div className="intake-section-block">
            <div className="intake-field-label">{t('Target mode', '选择目标类型')}</div>
            <div
              className={`intake-card-grid ${PLATFORM_META[draft.platform].types.length === 1 ? 'intake-card-grid--1' : PLATFORM_META[draft.platform].types.length === 2 ? 'intake-card-grid--2' : 'intake-card-grid--3'}`}
              role="radiogroup"
              aria-label={t('What to look for', '选择目标类型')}
            >
              {PLATFORM_META[draft.platform].types.map((kind) => {
                const meta = TYPE_META[kind];
                const selected = draft.targetType === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`intake-choice-card intake-choice-card--compact ${selected ? 'is-selected' : ''}`}
                    onClick={() => setDraft({ ...draft, targetType: kind, targetValue: '' })}
                  >
                    <strong>{t(meta.labelEn, meta.labelZh)}</strong>
                    <small>{t(meta.descEn, meta.descZh)}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Target Input + Guided Rules Side-by-Side */}
          <div className="intake-target-split">
            <div className="intake-section-block">
              <label className="wb-field" style={{ maxWidth: 'none' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t('Target content', '目标内容')}</span>
                  {guide.prefix && (
                    <span className="tag" style={{ fontSize: 10 }}>
                      {t('Prefix optional', '前缀可选')}: {guide.prefix}
                    </span>
                  )}
                </span>
                <Input
                  value={draft.targetValue}
                  required
                  maxLength={512}
                  aria-invalid={Boolean(rawValue && !validation.valid)}
                  onChange={(event) => setDraft({ ...draft, targetValue: event.target.value })}
                  placeholder={guide.placeholder}
                />
              </label>

              {rawValue && (
                <div className={`intake-validation-msg ${validation.valid ? 'is-ok' : 'is-err'}`} role="status">
                  {validation.valid ? (
                    <>
                      <CheckCircle2 size={14} />
                      <span>{t('Format looks valid. Click below to check availability and quota.', '格式符合要求，可点击下方按钮预检通道与预计消耗。')}</span>
                    </>
                  ) : (
                    <>
                      <XCircle size={14} />
                      <span>
                        {lang === 'zh'
                          ? (validation.reasonZh ?? guide.allowedZh)
                          : (validation.reasonEn ?? guide.allowedEn)}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="intake-example-bar">
                <span className="intake-example-label">
                  <Sparkles size={12} />
                  {t('Quick fill example:', '示例一键填入：')}
                </span>
                {guide.examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="intake-pill intake-pill--sm"
                    onClick={() => setDraft({ ...draft, targetValue: ex })}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <aside className="intake-guide-card" aria-label={t('Input format guidance', '输入格式引导')}>
              <div className="intake-guide-hd">
                <Info size={14} />
                <span>{t('Input guide & rules', '目标输入规范与示例')}</span>
              </div>
              <dl className="intake-guide-list">
                <div>
                  <dt>{t('Allowed', '允许输入')}</dt>
                  <dd>{t(guide.allowedEn, guide.allowedZh)}</dd>
                </div>
                <div>
                  <dt>{t('Not allowed', '禁止 / 常见误区')}</dt>
                  <dd>{t(guide.disallowedEn, guide.disallowedZh)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </fieldset>

        <div className="intake-actions">
          <Button type="submit" disabled={pending || !validation.valid || !isPlatformPermitted(draft.platform)} className="intake-primary">
            {pending ? t('Checking availability…', '正在检查可用性…') : t('Check target & set scope', '检查目标并设置范围')}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </>
  );
}

function ChannelFilterOptions({
  sf,
  range,
  setHint,
}: {
  sf: ResearchPlanPreviewResponse['fieldPolicy']['supportedFilters'];
  range: CollectionRange;
  setHint: <K extends keyof QueryHintsValue>(k: K, val: QueryHintsValue[K]) => void;
}) {
  const { t } = useI18n();
  if (!sf || !(sf.sortOptions.length > 0 || sf.supportsMinLikes || sf.supportsMinComments || sf.supportsExcludeReposts || sf.supportsTimeRange || sf.supportsLanguage)) {
    return null;
  }
  const sortLabels: Record<string, string> = {
    latest: t('Latest', '最新发布'),
    top: t('Top', '热度最高'),
    hot: t('Hot', '实时热门'),
    new: t('New', '最新'),
    relevance: t('Relevant', '相关性优先'),
    rising: t('Rising', '上升最快'),
  };
  const timeLabels: Record<'day' | 'week' | 'month' | 'year', string> = {
    day: t('24h', '近 1 天'),
    week: t('Week', '近 1 周'),
    month: t('Month', '近 1 月'),
    year: t('Year', '近 1 年'),
  };
  return (
    <div className="intake-filter-box">
      <div className="intake-filter-hd">
        <strong>{t('Channel filter & sort options', '平台筛选与排序条件（可选）')}</strong>
        <span className="tag" style={{ fontSize: 10 }}>
          {sf.engagementFilterMode === 'native' ? t('Native upstream query', '上游原生查询') : t('Post-filter / best-effort', '回传后过滤')}
        </span>
      </div>

      {sf.sortOptions.length > 0 && (
        <div className="intake-section-block">
          <div className="intake-field-label">{t('Sort mode', '排序方式')}</div>
          <div className="intake-pill-group">
            <button
              type="button"
              className={`intake-pill ${!range.queryHints.sort ? 'is-active' : ''}`}
              onClick={() => setHint('sort', undefined)}
            >
              {t('Provider default', '渠道默认')}
            </button>
            {sf.sortOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`intake-pill ${range.queryHints.sort === opt ? 'is-active' : ''}`}
                onClick={() => setHint('sort', opt as QueryHintsValue['sort'])}
              >
                {sortLabels[opt] ?? opt}
              </button>
            ))}
          </div>
        </div>
      )}

      {sf.supportsTimeRange && (
        <div className="intake-section-block">
          <div className="intake-field-label">{t('Upstream period hint', '上游时段权重')}</div>
          <div className="intake-pill-group">
            <button
              type="button"
              className={`intake-pill ${!range.queryHints.timeRange ? 'is-active' : ''}`}
              onClick={() => setHint('timeRange', undefined)}
            >
              {t('Match date window', '自动匹配采集窗口')}
            </button>
            {(['day', 'week', 'month', 'year'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`intake-pill ${range.queryHints.timeRange === opt ? 'is-active' : ''}`}
                onClick={() => setHint('timeRange', opt)}
              >
                {timeLabels[opt]}
              </button>
            ))}
          </div>
        </div>
      )}

      {(sf.supportsMinLikes || sf.supportsMinComments || sf.supportsLanguage) && (
        <div className="intake-card-grid intake-card-grid--3">
          {sf.supportsMinLikes && (
            <label className="wb-field">
              {t('Min likes / score', '最低点赞 / 分数')}
              <Input
                type="number"
                min={0}
                max={1000000}
                placeholder="0"
                value={range.queryHints.minLikes ?? ''}
                onChange={(e) => setHint('minLikes', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
          )}
          {sf.supportsMinComments && (
            <label className="wb-field">
              {t('Min replies / comments', '最低回复 / 评论数')}
              <Input
                type="number"
                min={0}
                max={1000000}
                placeholder="0"
                value={range.queryHints.minComments ?? ''}
                onChange={(e) => setHint('minComments', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
          )}
          {sf.supportsLanguage && (
            <label className="wb-field">
              {t('Language code (e.g. en)', '语言过滤（如 en / ja / zh）')}
              <Input
                maxLength={16}
                placeholder="en"
                value={range.queryHints.language ?? ''}
                onChange={(e) => setHint('language', e.target.value.trim() || undefined)}
              />
            </label>
          )}
        </div>
      )}

      {sf.supportsExcludeReposts && (
        <label className="intake-check" style={{ marginTop: 4 }}>
          <Checkbox
            checked={Boolean(range.queryHints.excludeReposts)}
            onCheckedChange={(v) => setHint('excludeReposts', v ? true : undefined)}
          />
          {t('Exclude reposts / retweets (recommended for original feedback)', '排除纯转发 / 转推内容（推荐勾选以提升原创讨论信噪比）')}
        </label>
      )}
    </div>
  );
}

export function IntakeScopeStep({
  result,
  source,
  range,
  setRange,
  pending,
  onContinue,
  onBack,
}: {
  result: ResearchPlanPreviewResponse;
  source?: CollectionSource;
  range: CollectionRange;
  setRange: (range: CollectionRange) => void;
  pending: boolean;
  onContinue: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const limits = getRangeLimits(result, range.fallback ? source?.fallbackProvider ?? undefined : undefined);
  const maximum = Math.min(limits.maxItems, range.comments ? Math.floor(2000 / (range.commentLimit + 1)) : limits.maxItems);
  const dayChoices = [...new Set([1, 3, 7, 30, 90, limits.maxDays].filter((n) => n > 0 && n <= limits.maxDays))];
  const itemPresets = [...new Set([10, 20, 50, 100, maximum].filter((n) => n >= 1 && n <= maximum))];
  const targetDisplay =
    result.matchedSource?.label ??
    (result.resolvedTarget
      ? `${PLATFORM_META[result.resolvedTarget.platform as PlatformKey]?.name ?? result.resolvedTarget.platform}: ${result.resolvedTarget.value}`
      : '');
  const sf = result.fieldPolicy.supportedFilters;
  const setHint = <K extends keyof QueryHintsValue>(k: K, val: QueryHintsValue[K]) => {
    const next = { ...range.queryHints, [k]: val };
    if (val === undefined || val === '' || val === false) delete next[k];
    setRange({ ...range, queryHints: next });
  };

  return (
    <>
      <div>
        <h2>{t('2. Set the collection scope', '2. 设置本次采集范围与过滤条件')}</h2>
        <p>
          {t('Target:', '当前采集目标：')} <strong>{targetDisplay}</strong>
          {result.resolutionStatus === 'on_demand_available' && (
            <small className="collection-hint"> · {t('On-demand research target', '按需实时检索目标')}</small>
          )}
        </p>
      </div>

      <form onSubmit={onContinue} className="intake-step-form">
        <fieldset className="intake-fields" disabled={pending}>
          {/* Time Range Pills (Zero dropdown) */}
          <div className="intake-section-block">
            <div className="intake-field-label">
              {t('Lookback window', '采集时间范围')}
              <small className="collection-hint" style={{ marginLeft: 8 }}>
                ({t(`Max allowed by policy: ${limits.maxDays} days`, `当前配额上限：最多回溯 ${limits.maxDays} 天`)})
              </small>
            </div>
            <div className="intake-pill-group">
              {dayChoices.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`intake-pill ${range.days === days ? 'is-active' : ''}`}
                  onClick={() => setRange({ ...range, days })}
                >
                  {t(`Last ${days} days`, `最近 ${days} 天`)}
                </button>
              ))}
            </div>
          </div>

          {/* Item Limit Input + Presets */}
          <div className="intake-section-block">
            <div className="intake-field-label">{t('Maximum items to collect', '本次采集条数上限')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <Input
                type="number"
                required
                min={1}
                max={maximum}
                style={{ width: 120 }}
                aria-label={t('Maximum items', '本次条数上限')}
                value={range.limit}
                onChange={(event) => setRange({ ...range, limit: Number(event.target.value) })}
              />
              <div className="intake-pill-group">
                {itemPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`intake-pill intake-pill--sm ${range.limit === preset ? 'is-active' : ''}`}
                    onClick={() => setRange({ ...range, limit: preset })}
                  >
                    {preset === maximum ? t(`Max (${preset})`, `上限 (${preset})`) : `${preset} ${t('items', '条')}`}
                  </button>
                ))}
              </div>
            </div>
            <p className="collection-hint">
              {t(
                `Up to ${maximum} items per run under channel and account quota limits.`,
                `结合当前通道单次限制与账号策略，本次最多请求 ${maximum} 条内容。`,
              )}
            </p>
          </div>

          {/* Comments toggle & per-post cap */}
          {limits.maxComments > 0 && (
            <div className="intake-section-block">
              <label className="intake-check">
                <Checkbox
                  checked={range.comments}
                  onCheckedChange={(comments) =>
                    setRange({
                      ...range,
                      comments,
                      limit: Math.min(range.limit, Math.floor(2000 / (range.commentLimit + 1))),
                    })
                  }
                />
                <span>
                  {t('Also collect post comments', '同时抓取主帖评论')}
                  <small className="collection-hint" style={{ marginLeft: 8 }}>
                    {t('(increases collection unit usage)', '（会按评论条数相应增加额度消耗）')}
                  </small>
                </span>
              </label>
              {range.comments && (
                <label className="wb-field" style={{ maxWidth: 260 }}>
                  {t(`Comments per post (1..${limits.maxComments})`, `每帖最多评论数（1..${limits.maxComments}）`)}
                  <Input
                    type="number"
                    required
                    min={1}
                    max={limits.maxComments}
                    value={range.commentLimit}
                    onChange={(event) => {
                      const commentLimit = Number(event.target.value);
                      setRange({
                        ...range,
                        commentLimit,
                        limit: Math.min(range.limit, Math.floor(2000 / (commentLimit + 1))),
                      });
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Flattened Channel Filter Hints */}
          <ChannelFilterOptions sf={sf} range={range} setHint={setHint} />

          {/* Optional Fallback Service */}
          {result.fieldPolicy.canUseFallback && source?.fallbackProvider && (
            <label className="intake-check">
              <Checkbox
                checked={range.fallback}
                onCheckedChange={(fallback) => {
                  const next = getRangeLimits(result, fallback ? source.fallbackProvider ?? undefined : undefined);
                  setRange({ ...range, fallback, comments: false, limit: Math.min(range.limit, next.maxItems) });
                }}
              />
              <span>
                {t('Use backup collection channel', '改用备用采集通道')} ({source.fallbackProvider})
              </span>
            </label>
          )}
        </fieldset>

        <div className="intake-actions">
          <Button type="submit" disabled={pending || range.limit < 1 || range.limit > maximum} className="intake-primary">
            {pending ? t('Calculating…', '正在估算消耗…') : t('See estimated usage', '下一步：核对预计消耗')}
            <ArrowRight size={16} />
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={onBack}>
            {t('Change target', '返回修改目标')}
          </Button>
        </div>
      </form>
    </>
  );
}

export function IntakeReviewStep({
  estimate,
  confirmed,
  setConfirmed,
  pending,
  isAdmin,
  onConfirm,
  onBack,
}: {
  estimate: CollectionEstimate;
  isAdmin: boolean;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const { request, result } = estimate;
  const units = isAdmin ? result.estimate.systemResources : result.estimate.personalResources;
  const targetLabel =
    result.matchedSource?.label ??
    (result.resolvedTarget
      ? `${PLATFORM_META[result.resolvedTarget.platform as PlatformKey]?.name ?? result.resolvedTarget.platform}: ${result.resolvedTarget.value}`
      : '');
  return (
    <>
      <div>
        <h2>{t('3. Confirm target & estimated usage', '3. 核对采集内容与预计额度消耗')}</h2>
        <p>
          {t(
            'New data will be saved as an independent batch inside this project once collection completes.',
            '任务完成后，新采集的数据将自动生成批次并纳入当前项目。',
          )}
        </p>
      </div>
      <dl className="intake-facts">
        <div>
          <dt>{t('Research target', '采集目标')}</dt>
          <dd>{targetLabel}</dd>
        </div>
        <div>
          <dt>{t('Collection scope', '采集范围')}</dt>
          <dd>
            {request.from.slice(0, 10)} – {request.to.slice(0, 10)} UTC · {t(`up to ${request.limit} items`, `最多 ${request.limit} 条`)} ·{' '}
            {request.includeComments ? t('with comments', '包含评论') : t('without comments', '不含评论')}
          </dd>
        </div>
        <div>
          <dt>{t('Estimated usage', '预计额度消耗')}</dt>
          <dd>
            {t(
              `${result.estimate.requests} external request(s) · ${units} collection units`,
              `${result.estimate.requests} 次外部请求 · ${units} 采集额度`,
            )}
          </dd>
        </div>
      </dl>
      {result.coverage.status === 'unknown' && (
        <p className="collection-hint">
          {t(
            `${result.coverage.existingItemCount} samples from this source already exist in the system. To reuse existing or shared batches without spending quota, check "Data Batches".`,
            `库中该目标在该时间段已有 ${result.coverage.existingItemCount} 条样本；若需直接复用已有批次或共享数据（零消耗），可前往「数据批次」页面引入。`,
          )}
        </p>
      )}
      <p className="collection-hint">
        {t(
          'Actual usage may vary slightly based on upstream results. Track live progress in Collection Jobs.',
          '实际消耗以实际返回结果为准；提交后将在「采集任务」实时跟踪进度。',
        )}
      </p>
      <label className="intake-check">
        <Checkbox checked={confirmed} onCheckedChange={setConfirmed} disabled={pending} />
        {t('I understand the estimated usage and want to start collecting.', '我已核对预计用量并确认发起本次采集。')}
      </label>
      <div className="intake-actions">
        <Button type="button" className="intake-primary" disabled={!confirmed || pending} onClick={onConfirm}>
          {pending ? t('Starting collection…', '正在提交…') : t('Confirm and start collecting', '确认开始采集')}
          <ArrowRight size={16} />
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onBack}>
          {t('Change the scope', '返回修改范围')}
        </Button>
      </div>
    </>
  );
}

const restrictionText: Record<ResearchCollectionRestriction, [string, string]> = {
  target_unavailable: ['This target is not available for on-demand collection under current permissions.', '当前账号策略下暂不支持直接采集此目标。'],
  manual_disabled: ['Your plan does not support on-demand collection.', '当前套餐策略未开启手动新采集。'],
  provider_choice: ['The backup collection service is unavailable for this target.', '该目标目前不能使用备用采集服务。'],
  scope_limit: ['Reduce the date range or number of requested items.', '请缩小时间范围或减少采集条数。'],
  provider_unavailable: ['The collection service is not ready. Choose another target or contact an administrator.', '采集服务尚未就绪。请更换目标，或联系管理员检查配置。'],
  network_disabled: ['External network collection is currently disabled on this server (SOURCE_NETWORK_ENABLED is off).', '当前服务端未开启外部网络采集开关（SOURCE_NETWORK_ENABLED=false）。'],
  credential_missing: ['The provider API key is not configured yet. Ask an administrator to add it.', '对应采集渠道的 API 密钥尚未配置，请联系管理员在后台添加后重试。'],
  credential_invalid: ['The provider API key was rejected upstream and needs rotation by an administrator.', '采集渠道 API 密钥被上游拒绝或失效，请联系管理员测试并轮换密钥。'],
  charge_unresolved: ['A previous request may have used quota. Ask an administrator to review it.', '上次采集可能已消耗额度，请联系管理员核对。'],
  source_inactive: ['Collection is paused for this target.', '该对象已暂停采集。'],
  source_access: ['Collection is unavailable for this target under your current permissions.', '当前账号配额策略未开放该平台或目标的采集权限。'],
  budget_unavailable: ['This collection service has no available budget.', '该采集服务暂无可用预算。'],
  quota_exhausted: ['There is not enough quota for this collection. Try a smaller request or return after it resets.', '当前可用额度不足。可减少采集量，或等额度恢复后再试。'],
  unsupported_scope: ['The collection service does not support this scope.', '当前采集服务不支持此参数范围。'],
};

export function IntakeRestriction({
  result,
  registrationPath,
  isAdmin,
  onBack,
}: {
  result: ResearchPlanPreviewResponse;
  registrationPath?: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const codes = result.restrictions ?? (result.resolutionStatus === 'needs_admin_source' ? ['target_unavailable'] : []);
  const channel = result.matchedSource?.provider;
  const providerCredBlocked =
    isAdmin && (codes.includes('provider_unavailable') || codes.includes('credential_missing') || codes.includes('credential_invalid'));
  const budgetBlocked = isAdmin && codes.includes('budget_unavailable');
  return (
    <Alert role="status" className="intake-restriction">
      <h3>{t('Collection cannot start yet', '暂时无法开始采集')}</h3>
      {codes.length ? (
        <ul>
          {codes.map((code) => (
            <li key={code}>{restrictionText[code] ? t(...restrictionText[code]) : t('Collection is currently restricted.', '当前采集受限。')}</li>
          ))}
        </ul>
      ) : (
        <p>{t('Try another target or contact an administrator.', '请更换研究目标，或联系管理员检查采集设置。')}</p>
      )}
      {providerCredBlocked && channel && (
        <p>{t(`Check the saved credential and network status for ${channel}.`, `请检查 ${channel} 的渠道凭证和联网状态。`)}</p>
      )}
      <div className="intake-actions">
        {isAdmin && registrationPath && <a href={registrationPath}>{t('Register source in Ops', '前往运维注册来源')}</a>}
        {providerCredBlocked && <a href="/sources?tab=providers">{t('Check provider credentials', '检查渠道凭证')}</a>}
        {budgetBlocked && <a href="/sources?tab=budgets">{t('Check provider budgets', '检查渠道预算')}</a>}
        <Button type="button" variant="outline" onClick={onBack}>
          {t('Try another target', '返回修改研究目标')}
        </Button>
      </div>
    </Alert>
  );
}
