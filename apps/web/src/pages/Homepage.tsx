import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  Menu,
  Palette,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { SiftlineLogo } from '../components/BrandMark';
import { useLogo } from '../components/brandContext';
import { useTheme } from '../components/themeContext';
import { type Platform, validateSearchTerm } from '../contracts/api';
import { useI18n } from '../i18n/translations';

interface HomepageProps {
  isAuthenticated: boolean;
  onOpenAuth: (tab?: 'login' | 'register') => void;
  onEnterWorkbench: (targetPath?: string) => void;
}

const PLATFORM_OPTIONS: Array<{ value: '' | Platform; label: string; labelZh: string }> = [
  { value: '', label: 'All Platforms', labelZh: '全平台' },
  { value: 'reddit', label: 'Reddit', labelZh: 'Reddit 社区' },
  { value: 'x', label: 'X (Twitter)', labelZh: 'X 平台' },
  { value: 'bluesky', label: 'Bluesky', labelZh: 'Bluesky' },
  { value: 'web', label: 'Web / HN / RSS', labelZh: 'Web / 资讯源' },
];

const SOLUTIONS_DATA = [
  {
    key: 'siftline-one',
    tag: 'SIFTLINE ONE',
    titleEn: 'Track market pain across threads and live feeds',
    titleZh: '跨社区讨论树与实时信息流追踪痛点信号',
    descEn:
      'Unify Reddit, X, Bluesky, and Hacker News into project-scoped monitoring views with thread-aware root deduplication.',
    descZh:
      '将 Reddit、X、Bluesky 与 Hacker News 聚合到项目级监测视图中，支持讨论根帖自动去重聚合。',
    route: '/projects',
    metric: '89 / 100',
    sub: 'Thread-Aware Active',
    chartType: 'lines',
  },
  {
    key: 'thread-radar',
    tag: 'THREAD RADAR',
    titleEn: 'Inspect nested discussions up to 32 hops deep',
    titleZh: '深层还原最高 32 跳嵌套评论树结构',
    descEn:
      'Switch cleanly between top-scored replies, filter-matched branches, and original poster follow-ups without triggering paid crawls.',
    descZh:
      '在热评排序、条件命中分支与楼主回复三大只读视图间秒级切换，永不误触收费抓包。',
    route: '/content',
    metric: '200 nodes',
    sub: 'Top · Matches · OP',
    chartType: 'gauge',
  },
  {
    key: 'pain-signals',
    tag: 'SIGNAL ENGINE',
    titleEn: 'Surface high-friction buyer pain automatically',
    titleZh: '自动识别高摩擦痛点词与热议讨论信号',
    descEn:
      'Combine bilingual pain regex matching, high comment-to-score heuristics, and NFKC 3-character boolean query terms.',
    descZh:
      '融合中英文痛点正则、高评论比启发式规则与 NFKC 三字符布尔检索组，秒级筛出高价值吐槽。',
    route: '/content',
    metric: '+373%',
    sub: 'Pain Signal Hit Rate',
    chartType: 'bubbles',
  },
  {
    key: 'hydrate',
    tag: 'ON-DEMAND HYDRATION',
    titleEn: 'Hydrate Reddit root comments with idempotency',
    titleZh: '按需批量水合 Reddit 主帖评论并严格幂等',
    descEn:
      'Select 1 to 30 Reddit root posts directly from project explorer and dispatch idempotent hydration jobs with progress polling.',
    descZh:
      '在项目上下文内勾选 1~30 条 Reddit 主帖，自动携带 Idempotency-Key 下发评论水合队列并轮询进度。',
    route: '/content',
    metric: '1..30 posts',
    sub: 'Max 50 replies/post',
    chartType: 'bars',
  },
  {
    key: 'observations',
    tag: 'OBSERVATION SNAPSHOTS',
    titleEn: 'Compare metric trajectories across snapshots',
    titleZh: '多快照指标演变与时间基准透明留痕',
    descEn:
      'Plot separate time series per source, provider, and metric while honoring sourceObservedAt fallback and null gap integrity.',
    descZh:
      '严格按（来源、渠道、指标）分组连线，标注 provider_snapshot 时间基准且保持 null 断档不补零。',
    route: '/content',
    metric: 'Multi-Obs',
    sub: 'Provider Attribution',
    chartType: 'lines',
  },
  {
    key: 'push-ingest',
    tag: 'PUSH PIPELINE',
    titleEn: 'Ingest external tickets via Machine API Keys',
    titleZh: '通过机器 API Key 批量推流接入外部工单',
    descEn:
      'Validate 1 MiB batch limits, 4 KiB titles, and perpetual Idempotency-Key deduplication on external_ingest sources.',
    descZh:
      '内建 1 MiB 批负载与单条大小校验、43 位一次性 Bearer 密钥隔离及永续幂等防重入。',
    route: '/sources',
    metric: '<= 1 MiB',
    sub: '1..100 items / batch',
    chartType: 'bars',
  },
  {
    key: 'budget-guard',
    tag: 'QUOTA & UNBLOCK',
    titleEn: 'Enforce daily & monthly vendor quota caps',
    titleZh: '日/月请求与资源双配额防线及付费确认解锁',
    descEn:
      'Prevent runaway vendor charges with conservative budget meters, optimistic locking, and explicit charge acknowledgement.',
    descZh:
      '在任务触发前用保守预留配额拦截超限风险，并针对 unknown/starting 状态任务强制显式收费确认。',
    route: '/sources',
    metric: '7 Providers',
    sub: 'Live Budget Meters',
    chartType: 'gauge',
  },
  {
    key: 'streaming-export',
    tag: 'STREAMING EXPORT',
    titleEn: 'Verify complete JSON & formula-safe CSV streams',
    titleZh: '校验式流式导出 JSON 与防注入 CSV 报表',
    descEn:
      'Stream up to 50,000 rows per batch, verify result.complete === true before saving, and resume truncated exports via nextCursor.',
    descZh:
      '支持单批最高 5 万行流式下载、严格校验 result.complete === true 与游标续段导出。',
    route: '/content',
    metric: '50,000 rows',
    sub: 'nextCursor Resume',
    chartType: 'bars',
  },
  {
    key: 'workspace-rbac',
    tag: 'TEAM RBAC',
    titleEn: 'Role-isolated research assets & saved filters',
    titleZh: '三角色权限矩阵与个人研究查询沉淀',
    descEn:
      'Empower viewers to save queries and optimistic-locked annotations while reserving collection and budgets for admins and owners.',
    descZh:
      'owner/admin 管控采集与密钥，viewer 可在个人工作区自由保存查询条件与乐观锁批注。',
    route: '/workspace',
    metric: '3 Roles',
    sub: 'Owner · Admin · Viewer',
    chartType: 'bubbles',
  },
];

const STATS_DATA = [
  {
    num: '7',
    labelEn: 'Live Collector Providers',
    labelZh: '已注册实时采集渠道',
    descEn: 'Capability-driven integration across Reddit, X, Bluesky, Hacker News, and allowlisted HTTPS feeds.',
    descZh: '覆盖 Reddit、X、Bluesky、Hacker News 与白名单订阅源，全表单受能力矩阵实时约束。',
  },
  {
    num: '50K',
    labelEn: 'Streaming Export Row Limit',
    labelZh: '单段流式导出行数上限',
    descEn: 'Unbuffered JSON and formula-sanitized CSV exports with strict completion verification and cursor resume.',
    descZh: '无缓冲直传 JSON 与防公式注入 CSV，强制校验流完整性并支持 nextCursor 续段下载。',
  },
  {
    num: '32',
    labelEn: 'Thread Ancestor Hop Depth',
    labelZh: '讨论评论树溯源深度上限',
    descEn: 'Trace nested replies back to discussion roots with explicit contextMissing & capped guardrails.',
    descZh: '支持 0~32 层深度的父子评论缩进树，自动识别孤儿节点并标注父链缺失状态。',
  },
  {
    num: '100%',
    labelEn: 'Stored-Sample Transparency',
    labelZh: '已存样本口径透明度',
    descEn: 'Every overview facet preserves unknown-time buckets, uncollected date gaps, and non-exclusive attribution.',
    descZh: '所有趋势图严格保留发布时间未知分桶、未采集日期留白与非互斥多渠道归因。',
  },
];

const INDEX_LEADERBOARD = [
  { community: 'r/devops · Observability', mentions: '1,140', pct: 100, color: 'var(--teal)' },
  { community: 'r/SaaS · Billing Friction', mentions: '842', pct: 74, color: 'var(--wisteria)' },
  { community: 'X · Cloud Egress Watch', mentions: '618', pct: 54, color: 'var(--teal)' },
  { community: 'r/LocalLLaMA · Quantization', mentions: '496', pct: 43, color: 'var(--wisteria)' },
  { community: 'news.ycombinator · FinOps', mentions: '388', pct: 34, color: 'var(--teal)' },
  { community: 'bsky.app · DevTools Feed', mentions: '312', pct: 27, color: 'var(--wisteria)' },
  { community: 'Support Push · Ticket Bridge', mentions: '248', pct: 22, color: 'var(--teal)' },
];

const TESTIMONIALS = [
  {
    company: 'FINOPS LABS',
    quoteEn:
      'Siftline replaced brittle social scrapers with a single contract-verified intelligence workbench. Our product team finds pricing friction threads days before churn tickets spike.',
    quoteZh:
      'Siftline 用统一且口径透明的情报工作台取代了零散脚本。产品团队往往在客户工单爆发前几天，就已在社区讨论中锁定定价摩擦痛点。',
    author: 'Elena Vance',
    role: 'VP of Product Intelligence · FinOps Labs',
    initials: 'EV',
    metric: '+373%',
    metricLabelEn: 'Faster pain-signal discovery across threads',
    metricLabelZh: '跨社区痛点讨论定位效率提升',
  },
  {
    company: 'INFRA PULSE',
    quoteEn:
      'Having non-zero-filled trend gaps and unknown-timestamp counters stops our analysts from misreading collection windows as quiet markets.',
    quoteZh:
      '“未采集日期不补零”与“发布时间未知单列统计”彻底杜绝了分析师把采集空窗期误判为市场冷清的情况。',
    author: 'Marcus Thorne',
    role: 'Staff Data Strategist · Infra Pulse',
    initials: 'MT',
    metric: '0',
    metricLabelEn: 'Accidental duplicate vendor crawls via Idempotency-Key',
    metricLabelZh: '幂等键保障下的重复付费采集失误',
  },
];

const RESOURCES_DATA = [
  {
    titleEn: 'How Thread-Aware Folding Turns Scattered Replies Into Actionable Signal',
    titleZh: '讨论根帖上溯折叠如何把碎片化评论还原为完整需求脉络',
    descEn: 'Learn why matching a depth-3 comment and anchoring to its root thread reveals true buyer intent.',
    descZh: '了解当深层评论命中痛点词时，上溯至讨论根帖如何避免丢失上下文误判。',
    tags: ['Guide', 'Thread Radar'],
    tone: 'opal',
  },
  {
    titleEn: 'Why Stored-Sample Dashboards Never Zero-Fill Uncollected Dates',
    titleZh: '为什么专业分析面板绝不对未采集空缺日期补零连线',
    descEn: 'Visual integrity rules that separate real demand drops from source collection gaps.',
    descZh: '拆解真实讨论热度下滑与采集调度窗口空缺之间的统计边界。',
    tags: ['Methodology', 'Visualization'],
    tone: 'dark',
  },
  {
    titleEn: 'Designing Safe Paid Crawl Operations With Conservative Quotas',
    titleZh: '用保守预留配额与收费确认机制守住第三方抓取成本底线',
    descEn: 'Practical guardrails for unknown-phase jobs, source blocking, and idempotent retries.',
    descZh: '解析 starting/unknown 任务锁源机制、Idempotency-Key 缓存与配额门禁设计。',
    tags: ['Architecture', 'Collection Ops'],
    tone: 'wisteria',
  },
  {
    titleEn: 'Streaming 50,000-Row Exports Without Truncation Blindspots',
    titleZh: '五万行级流式导出：完整性校验与游标续传实战',
    descEn: 'Validate result.complete === true and sanitize CSV cells against spreadsheet injection.',
    descZh: '如何通过 Fetch 流校验完整标记位并安全防注入导出研究数据集。',
    tags: ['Engineering', 'Exports'],
    tone: 'opal',
  },
];

function MiniCardVisual({ type }: { type: string }) {
  if (type === 'gauge') {
    return (
      <div className="hp-sol-mock-inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
          <span>QUOTA &amp; DENSITY</span>
          <span style={{ color: 'var(--teal)' }}>LIVE</span>
        </div>
        <svg viewBox="0 0 180 95" style={{ width: '100%', height: 'auto', margin: '6px 0' }}>
          <path d="M 24 80 A 66 66 0 0 1 156 80" fill="none" stroke="#e9ece6" strokeWidth="14" strokeLinecap="round" />
          <path d="M 24 80 A 66 66 0 0 1 138 35" fill="none" stroke="var(--purple)" strokeWidth="14" strokeLinecap="round" />
          <text x="90" y="72" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">
            84%
          </text>
          <text x="90" y="88" textAnchor="middle" fontSize="9" fill="#59645c">
            Safe headroom
          </text>
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
          <span>Daily req: 28/120</span>
          <span>Rev 3</span>
        </div>
      </div>
    );
  }
  if (type === 'bubbles') {
    return (
      <div className="hp-sol-mock-inner">
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>SIGNAL CLUSTERS</div>
        <svg viewBox="0 0 210 118" style={{ width: '100%', height: 'auto' }}>
          <line x1="20" y1="18" x2="195" y2="18" stroke="#eef1ef" />
          <line x1="20" y1="56" x2="195" y2="56" stroke="#eef1ef" />
          <line x1="20" y1="94" x2="195" y2="94" stroke="#eef1ef" />
          <circle cx="62" cy="52" r="24" fill="var(--purple)" opacity="0.88" />
          <circle cx="112" cy="70" r="28" fill="var(--teal)" opacity="0.85" />
          <circle cx="158" cy="40" r="18" fill="var(--wisteria)" opacity="0.92" />
          <circle cx="164" cy="84" r="12" fill="var(--apricot)" opacity="0.9" />
        </svg>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Pain vs. Discussion Density</div>
      </div>
    );
  }
  if (type === 'bars') {
    return (
      <div className="hp-sol-mock-inner">
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>DAILY SIGNAL BUCKETS</div>
        <svg viewBox="0 0 210 112" style={{ width: '100%', height: 'auto' }}>
          {[42, 68, 0, 84, 56, 92, 64].map((h, i) =>
            h === 0 ? (
              <line key={i} x1={18 + i * 26} y1="98" x2={34 + i * 26} y2="98" stroke="#cfd5d1" strokeDasharray="2 2" strokeWidth="2" />
            ) : (
              <rect
                key={i}
                x={18 + i * 26}
                y={98 - h}
                width="16"
                height={h}
                rx="3"
                fill={i % 2 === 0 ? 'var(--purple)' : 'var(--teal)'}
              />
            ),
          )}
        </svg>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Gap days preserved (no zero-fill)</div>
      </div>
    );
  }
  return (
    <div className="hp-sol-mock-inner">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
        <span>OBSERVATION SNAPSHOTS</span>
        <span style={{ color: 'var(--purple)' }}>kaix · scrapebadger</span>
      </div>
      <svg viewBox="0 0 210 110" style={{ width: '100%', height: 'auto' }}>
        <line x1="12" y1="24" x2="198" y2="24" stroke="#eef1ef" />
        <line x1="12" y1="58" x2="198" y2="58" stroke="#eef1ef" />
        <line x1="12" y1="92" x2="198" y2="92" stroke="#eef1ef" />
        <path d="M 14 78 L 52 72 L 94 58 L 138 38 L 194 26" fill="none" stroke="var(--purple)" strokeWidth="2.4" />
        <path d="M 14 86 L 52 80 L 94 74 L 138 66 L 194 52" fill="none" stroke="var(--teal)" strokeWidth="2.2" />
        <path d="M 14 68 L 52 62 L 94 46 L 138 48 L 194 38" fill="none" stroke="var(--apricot)" strokeWidth="2" />
      </svg>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>UTC Daily Time Basis</div>
    </div>
  );
}

export function Homepage({ isAuthenticated, onOpenAuth, onEnterWorkbench }: HomepageProps) {
  const { lang, setLang, t } = useI18n();
  const { activeLogo, setSwitcherOpen } = useLogo();
  const { palette, setStudioOpen } = useTheme();

  const [scrolled, setScrolled] = useState(false);
  const [openMega, setOpenMega] = useState<'product' | 'solutions' | 'resources' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Hero query pill
  const [heroQuery, setHeroQuery] = useState('');
  const [heroPlatform, setHeroPlatform] = useState<'' | Platform>('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeFilter, setScopeFilter] = useState('');
  const [heroError, setHeroError] = useState<string | null>(null);

  // Promo widget interactive state
  const [promoPlatform, setPromoPlatform] = useState<'all' | 'reddit' | 'x' | 'bluesky'>('all');
  const [promoSignal, setPromoSignal] = useState<'all' | 'pain' | 'discussion'>('all');

  // Solutions accordion + carousel
  const [expandedSol, setExpandedSol] = useState<string | null>(null);
  const solTrackRef = useRef<HTMLDivElement>(null);
  const resTrackRef = useRef<HTMLDivElement>(null);

  // Stats active row
  const [activeStat, setActiveStat] = useState(0);

  // Testimonial index
  const [quoteIdx, setQuoteIdx] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleHeroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHeroError(null);
    const trimmed = heroQuery.trim();
    if (trimmed) {
      const err = validateSearchTerm(trimmed);
      if (err) {
        setHeroError(err);
        return;
      }
    }
    const qs = new URLSearchParams();
    if (trimmed) qs.set('query', trimmed);
    if (heroPlatform) qs.set('platform', heroPlatform);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    onEnterWorkbench(`/content${suffix}`);
  };

  const scrollTrack = (ref: React.RefObject<HTMLDivElement | null>, dir: -1 | 1) => {
    ref.current?.scrollBy({ left: dir * 430, behavior: 'smooth' });
  };

  const promoGaugeScore =
    promoSignal === 'pain' ? 92 : promoSignal === 'discussion' ? 84 : promoPlatform === 'reddit' ? 91 : 89;

  const filteredPlatforms = PLATFORM_OPTIONS.filter((p) =>
    `${p.label} ${p.labelZh} ${p.value}`.toLowerCase().includes(scopeFilter.toLowerCase()),
  );

  const curQuote = TESTIMONIALS[quoteIdx];

  return (
    <div className="hp-root" onClick={() => scopeOpen && setScopeOpen(false)}>
      {/* Top Announcement Ribbon */}
      <div className="hp-promo-strip">
        <strong>{t('EXPLORE SIFTLINE', '探索 SIFTLINE')}</strong>
        <span>
          {t(
            'The unified social, community & thread-aware market intelligence workbench',
            '面向社区讨论树、多渠道观测与痛点信号的统一市场情报工作台',
          )}
        </span>
      </div>

      {/* Sticky Semrush-Style Header */}
      <header className={`hp-header-wrap ${scrolled ? 'scrolled' : ''} ${openMega ? 'menu-open' : ''}`}>
        <div className="hp-header">
          <div className="hp-brand-cluster">
            <button
              type="button"
              className="hp-logo-btn"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <SiftlineLogo
                size={28}
                fontSize={20}
                subLabel={t('Market Intelligence', '市场信号情报')}
              />
            </button>
            <button
              type="button"
              className="hp-mark-pill"
              onClick={() => setSwitcherOpen(true)}
              title={t('Switch among 30 brand SVG marks', '切换 30 套品牌图标方案')}
            >
              <span>
                {activeLogo.num}/30
              </span>
              <ChevronDown size={12} />
            </button>
            <button
              type="button"
              className="hp-mark-pill"
              onClick={() => setStudioOpen(true)}
              title={t('Switch brand color palette presets or customize colors', '切换品牌配色预设或自定义颜色替换')}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 99,
                  background: palette.accent,
                  border: '1px solid rgba(0,0,0,0.2)',
                  display: 'inline-block',
                }}
              />
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 99,
                  background: palette.accent2,
                  marginLeft: -5,
                  border: '1px solid rgba(0,0,0,0.15)',
                  display: 'inline-block',
                }}
              />
              <Palette size={11} />
              <span>{lang === 'zh' ? palette.nameZh.split(' ')[0] : palette.nameEn.split(' ')[0]}</span>
              <ChevronDown size={12} />
            </button>
          </div>

          <nav className="hp-nav" aria-label="Main navigation">
            <button
              type="button"
              className={`hp-nav-item ${openMega === 'product' ? 'active' : ''}`}
              onClick={() => setOpenMega(openMega === 'product' ? null : 'product')}
            >
              {t('Product', '产品矩阵')} <ChevronDown size={14} />
            </button>
            <a className="hp-nav-item" href="#capabilities" onClick={() => setOpenMega(null)}>
              {t('Capabilities', '能力体系')}
            </a>
            <button
              type="button"
              className={`hp-nav-item ${openMega === 'solutions' ? 'active' : ''}`}
              onClick={() => setOpenMega(openMega === 'solutions' ? null : 'solutions')}
            >
              {t('Solutions', '场景方案')} <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className={`hp-nav-item ${openMega === 'resources' ? 'active' : ''}`}
              onClick={() => setOpenMega(openMega === 'resources' ? null : 'resources')}
            >
              {t('Resources', '研究资源')} <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className="hp-nav-item"
              onClick={() => {
                setOpenMega(null);
                onEnterWorkbench('/projects');
              }}
            >
              {t('Workbench', '进入工作台')} <ArrowUpRight size={14} />
            </button>
          </nav>

          <div className="hp-actions">
            <button
              type="button"
              className="hp-lang-chip"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              title="Toggle EN / 中文"
            >
              {lang === 'en' ? '中文' : 'EN'}
            </button>
            <button
              type="button"
              className="sr-btn sr-btn--outline sr-btn--sm"
              onClick={() => onOpenAuth('login')}
            >
              {isAuthenticated ? t('Switch Account', '切换账号') : t('Log In', '登录')}
            </button>
            <button
              type="button"
              className="sr-btn sr-btn--dark sr-btn--sm"
              onClick={() => onEnterWorkbench('/projects')}
            >
              {isAuthenticated ? t('Open Workbench', '打开工作台') : t('Start for free', '立即体验')}
            </button>
          </div>

          <button
            type="button"
            className="hp-mobile-toggle"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Mega Menus (Semrush 4-column + featured card) */}
        {openMega && (
          <div className="hp-megamenu" onMouseLeave={() => setOpenMega(null)}>
            <div className="hp-megamenu-inner">
              {openMega === 'product' && (
                <>
                  <div className="hp-mega-col">
                    <h4>{t('Monitoring & Overview', '项目监测与总览')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/projects'); }}>
                        {t('Projects Overview', '监测项目概览')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/projects'); }}>
                        {t('Daily Facets & Trends', 'UTC 分日趋势分析')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/projects'); }}>
                        {t('Cross-Provider Attribution', '跨渠道发现归因')}
                      </button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('Research & Discovery', '内容检索与深挖')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content'); }}>
                        {t('Content Explorer', '内容流检索台')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content?signal=pain'); }}>
                        {t('Pain Signal Filter', '中英文痛点信号筛选')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content'); }}>
                        {t('3-View Thread Tree', '三视图讨论评论树')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content'); }}>
                        {t('Batch Reddit Hydration', 'Reddit 批量评论水合')}
                      </button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('Collection & Quotas', '来源与预算治理')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/sources'); }}>
                        {t('Sources & Capabilities', '采集来源与能力约束')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/sources'); }}>
                        {t('Push Ingest (1 MiB)', '外部标准化推流导入')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/sources'); }}>
                        {t('Provider Budgets', '渠道日/月预算额度')}
                      </button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('Workspace & Access', '工作区与权限')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/workspace'); }}>
                        {t('Saved Queries & Notes', '保存查询与个人批注')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/settings'); }}>
                        {t('Machine API Keys', '机器 API 密钥管理')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/settings'); }}>
                        {t('Invite Codes (RBAC)', '团队邀请码与角色矩阵')}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {openMega === 'solutions' && (
                <>
                  <div className="hp-mega-col">
                    <h4>{t('By Use Case', '按研究场景')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content?signal=pain'); }}>
                        {t('Buyer Pain Discovery', '客户痛点与抱怨挖掘')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content?signal=discussion'); }}>
                        {t('High-Engagement Threads', '高热讨论帖跟踪')}
                      </button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('By Platform', '按目标平台')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content?platform=reddit'); }}>Reddit (kaix / red_crawler)</button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content?platform=x'); }}>X (twitterapis / scrapebadger)</button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content?platform=bluesky'); }}>Bluesky AppView</button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('By Team Role', '按团队角色')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/settings'); }}>Owner · Governance &amp; Admin Invites</button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/sources'); }}>Admin · Collection &amp; Quotas</button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/workspace'); }}>Viewer · Read &amp; Annotations</button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('Data Exports', '流式导出')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content'); }}>
                        {t('Verified JSON Stream', '校验完整性的 JSON 导出')}
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/content'); }}>
                        {t('Formula-Safe CSV', '防公式注入 CSV 导出')}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {openMega === 'resources' && (
                <>
                  <div className="hp-mega-col">
                    <h4>{t('Data Standards', '数据口径规范')}</h4>
                    <div className="hp-mega-links">
                      <a className="hp-mega-link" href="#index" onClick={() => setOpenMega(null)}>
                        {t('Stored-Sample Coverage', '已存样本口径声明')}
                      </a>
                      <a className="hp-mega-link" href="#stats" onClick={() => setOpenMega(null)}>
                        {t('Non-Zero-Fill Trends', '空缺日期不补零原则')}
                      </a>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('API Contracts', '接口与系统探针')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/settings'); }}>
                        OpenAPI 3.0 Inspector
                      </button>
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onEnterWorkbench('/settings'); }}>
                        /healthz &amp; /readyz Probes
                      </button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('Brand System', '品牌设计')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); setSwitcherOpen(true); }}>
                        {t('Explore 30 Logo Concepts', '浏览 30 套 SVG 品牌图标')}
                      </button>
                    </div>
                  </div>
                  <div className="hp-mega-col">
                    <h4>{t('Quick Launch', '快速开始')}</h4>
                    <div className="hp-mega-links">
                      <button className="hp-mega-link" onClick={() => { setOpenMega(null); onOpenAuth('register'); }}>
                        {t('Redeem Invite Code', '使用邀请码注册')}
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div className="hp-mega-feature">
                <div className="hp-mega-feature-mock">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                    <span>SIGNAL GATEWAY</span>
                    <span className="wb-pill wb-pill--purple">v1</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    {t('Direct access to Siftline datasets via Machine Keys', '通过受限机器密钥直连 Siftline 数据网关')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>43-char Bearer · SHA-256 hashed</div>
                </div>
                <button
                  type="button"
                  className="hp-mega-link"
                  style={{ fontWeight: 700, color: 'var(--ink)' }}
                  onClick={() => {
                    setOpenMega(null);
                    onEnterWorkbench('/settings');
                  }}
                >
                  {t('Configure API Keys →', '前往配置机器密钥 →')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Menu Drawer */}
        {mobileMenuOpen && (
          <div style={{ background: 'var(--white)', borderTop: '1px solid var(--wb-border)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <button className="hp-mega-link" onClick={() => { setMobileMenuOpen(false); onEnterWorkbench('/projects'); }}>{t('Projects Overview', '监测项目概览')}</button>
            <button className="hp-mega-link" onClick={() => { setMobileMenuOpen(false); onEnterWorkbench('/content'); }}>{t('Content Explorer', '内容检索与评论树')}</button>
            <button className="hp-mega-link" onClick={() => { setMobileMenuOpen(false); onEnterWorkbench('/sources'); }}>{t('Sources & Budgets', '来源采集与预算')}</button>
            <button className="hp-mega-link" onClick={() => { setMobileMenuOpen(false); setSwitcherOpen(true); }}>{t('Switch Brand Logo (30)', '更换品牌图标 (30选1)')}</button>
            <button className="hp-mega-link" onClick={() => { setMobileMenuOpen(false); setStudioOpen(true); }}>{t('Color Palette Studio', '更换首页配色方案')}</button>
            <div style={{ display: 'flex', gap: 10, paddingTop: 10, borderTop: '1px solid var(--wb-border-soft)' }}>
              <button className="sr-btn sr-btn--outline sr-btn--sm" style={{ flex: 1 }} onClick={() => { setMobileMenuOpen(false); onOpenAuth('login'); }}>
                {t('Log In', '登录')}
              </button>
              <button className="sr-btn sr-btn--dark sr-btn--sm" style={{ flex: 1 }} onClick={() => { setMobileMenuOpen(false); onEnterWorkbench('/projects'); }}>
                {t('Workbench', '工作台')}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Hero Band (Mineral Opal -> Soft Wisteria gradient + Concentric Texture) */}
      <div className="hp-hero-band">
        <div className="hp-hero-bg" aria-hidden="true">
          <div className="hp-hero-rings" />
          <div className="hp-hero-rings hp-hero-rings--left" />
          <div className="hp-hero-slash" />
        </div>
        <section className="hp-hero">
          <h1>
            {t(
              'Be found in every community where signals start',
              '在每一处真实讨论萌芽之地，先行捕捉市场信号',
            )}
          </h1>
          <p className="hp-hero-sub">
            {t(
              'The unified intelligence platform to monitor Reddit threads, X chatter, Bluesky feeds, and web discussions — backed by verifiable observation snapshots.',
              '面向 Reddit 深层讨论树、X 舆论流、Bluesky 与 Web 资讯的统一市场监测工作台，用可验证的多快照观测留痕支撑每一项判断。',
            )}
          </p>

          {/* Hero Pill Search Container */}
          <form className="hp-search-tray" onSubmit={handleHeroSubmit} onClick={(e) => e.stopPropagation()}>
            <div className="hp-search-input-wrap">
              <Search size={17} color="#7a847e" />
              <input
                value={heroQuery}
                onChange={(e) => {
                  setHeroQuery(e.target.value);
                  setHeroError(null);
                }}
                placeholder={t('Enter topic, pain keyword, or phrase (e.g. pricing)', '输入监测词或痛点短语（如 pricing、latency）')}
                aria-label="Search market signals"
              />
              <button
                type="button"
                className="hp-scope-btn"
                onClick={() => setScopeOpen((v) => !v)}
              >
                <span>
                  {heroPlatform
                    ? PLATFORM_OPTIONS.find((p) => p.value === heroPlatform)?.label
                    : t('All', '全平台')}
                </span>
                <ChevronDown size={13} />
              </button>
            </div>

            {scopeOpen && (
              <div className="hp-scope-popover">
                <input
                  placeholder={t('Filter platform...', '筛选渠道平台...')}
                  value={scopeFilter}
                  onChange={(e) => setScopeFilter(e.target.value)}
                  autoFocus
                />
                {filteredPlatforms.map((opt) => (
                  <button
                    key={opt.value || 'all'}
                    type="button"
                    className={`hp-scope-option ${heroPlatform === opt.value ? 'active' : ''}`}
                    onClick={() => {
                      setHeroPlatform(opt.value);
                      setScopeOpen(false);
                    }}
                  >
                    <span>{lang === 'zh' ? opt.labelZh : opt.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{opt.value || '*'}</span>
                  </button>
                ))}
              </div>
            )}

            <button type="submit" className="sr-btn sr-btn--wisteria sr-btn--lg">
              {t('Get insights', '立即洞察')}
            </button>
          </form>

          {heroError && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sem-red)', fontWeight: 600 }}>
              {heroError}
            </div>
          )}

          <div className="hp-hero-hint">
            <span>{t('Try instant filter:', '快速预填检索：')}</span>
            {['pricing', 'latency', 'billing'].map((sample) => (
              <button
                key={sample}
                type="button"
                className="hp-hero-chip"
                onClick={() => {
                  setHeroQuery(sample);
                  setHeroError(null);
                }}
              >
                {sample}
              </button>
            ))}
          </div>
        </section>

        {/* Dual Asymmetric Promo Cards (Semrush 02-promo-products) */}
        <section className="hp-promo-grid">
          <div className="hp-promo-card hp-promo-card--primary">
            <div className="hp-promo-hatch sem-hatch-wisteria" />
            <div className="hp-promo-copy">
              <h2>
                {t('Capture signals in threads and live feeds.', '捕捉社区讨论树与实时信息流中的高价值信号。')}
              </h2>
              <div>
                <p className="hp-promo-desc">
                  {t(
                    'Powered by multi-provider pull & push connectors, Siftline folds comment matches to root discussions while keeping every sample auditable.',
                    '依托多渠道拉取与外部推流管道，Siftline 自动将深层评论上溯折叠至根帖，同时保留每一条观测的来源与时间基准。',
                  )}
                </p>
                <button
                  type="button"
                  className="sr-btn sr-btn--white"
                  onClick={() => onEnterWorkbench('/projects')}
                >
                  {t('Explore workbench', '进入监测工作台')}
                </button>
              </div>
            </div>

            {/* Embedded Interactive Signal Overview Widget */}
            <div className="hp-promo-frame">
              <div className="hp-promo-widget">
                <div className="hp-widget-header">
                  <h3>{t('Signal Overview', '信号全景预览')}</h3>
                  <select
                    className="wb-select"
                    style={{ fontSize: 12, padding: '5px 10px' }}
                    value={promoSignal}
                    onChange={(e) => setPromoSignal(e.target.value as typeof promoSignal)}
                    aria-label="Filter signal mode"
                  >
                    <option value="all">{t('All Signals', '全部信号')}</option>
                    <option value="pain">{t('Pain Signals', '痛点投诉信号')}</option>
                    <option value="discussion">{t('High Discussion', '高热讨论信号')}</option>
                  </select>
                </div>

                <div className="hp-widget-tabs" style={{ alignSelf: 'flex-start' }}>
                  {(['all', 'reddit', 'x', 'bluesky'] as const).map((plat) => (
                    <button
                      key={plat}
                      type="button"
                      className={`hp-widget-tab ${promoPlatform === plat ? 'active' : ''}`}
                      onClick={() => setPromoPlatform(plat)}
                    >
                      {plat === 'all' ? t('All Sources', '全部') : plat.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 16, alignItems: 'center' }}>
                  <svg viewBox="0 0 140 105" style={{ width: '100%', height: 'auto' }}>
                    <path d="M 18 82 A 52 52 0 0 1 122 82" fill="none" stroke="#e9ece6" strokeWidth="12" strokeLinecap="round" />
                    <path
                      d="M 18 82 A 52 52 0 0 1 114 52"
                      fill="none"
                      stroke="var(--sem-green)"
                      strokeWidth="12"
                      strokeLinecap="round"
                    />
                    <text x="70" y="72" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">
                      {promoGaugeScore}
                    </text>
                    <text x="70" y="90" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--sem-green)">
                      {t('High Signal', '高信号密度')}
                    </text>
                  </svg>

                  <svg viewBox="0 0 240 105" style={{ width: '100%', height: 'auto' }}>
                    <line x1="12" y1="20" x2="232" y2="20" stroke="#eef1ef" />
                    <line x1="12" y1="52" x2="232" y2="52" stroke="#eef1ef" />
                    <line x1="12" y1="84" x2="232" y2="84" stroke="#eef1ef" />
                    <path
                      d={
                        promoSignal === 'pain'
                          ? 'M 14 78 L 58 60 L 106 64 L 154 34 L 228 20'
                          : 'M 14 74 L 58 68 L 106 50 L 154 44 L 228 28'
                      }
                      fill="none"
                      stroke="var(--purple)"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M 14 82 L 58 76 L 106 72 L 154 58 L 228 48"
                      fill="none"
                      stroke="var(--teal)"
                      strokeWidth="2.2"
                    />
                    <text x="14" y="100" fontSize="9" fill="#7c857f">Nov 10</text>
                    <text x="110" y="100" fontSize="9" fill="#7c857f">Nov 14</text>
                    <text x="200" y="100" fontSize="9" fill="#7c857f">Nov 18</text>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="hp-promo-card hp-promo-card--secondary">
            <div className="hp-promo-hatch sem-hatch-wisteria" />
            <h2 style={{ position: 'relative', zIndex: 2 }}>
              {t('Ingest & query via Machine API.', '机器密钥直连，推流导入与自动化检索。')}
            </h2>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <p className="hp-promo-desc">
                {t(
                  'Issue source-scoped 43-character Bearer tokens for automated 1 MiB push ingestion, scheduled exports, and live OpenAPI inspection.',
                  '签发绑定指定来源范围的 43 位一次性 Bearer 密钥，支持 1 MiB 批量推流与自动化研究流水线。',
                )}
              </p>
              <button
                type="button"
                className="sr-btn sr-btn--outline"
                onClick={() => onEnterWorkbench('/settings')}
              >
                {t('Manage API Keys', '管理机器密钥')}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Connector / Source Logo Strip */}
      <section className="hp-logos-band" aria-label="Supported data sources and protocols">
        {[
          { name: 'Reddit · kaix', dot: 'var(--purple)' },
          { name: 'red_crawler', dot: 'var(--teal)' },
          { name: 'X · scrapebadger', dot: 'var(--ink)' },
          { name: 'twitterapis', dot: '#527bc5' },
          { name: 'Bluesky AppView', dot: 'var(--teal)' },
          { name: 'newsnow · HN', dot: '#d68245' },
          { name: 'external_ingest', dot: 'var(--purple)' },
        ].map((item) => (
          <div key={item.name} className="hp-source-emblem">
            <span style={{ width: 9, height: 9, borderRadius: 2, background: item.dot, display: 'inline-block' }} />
            <span>{item.name}</span>
          </div>
        ))}
      </section>

      {/* Enterprise Dark Showcase (03-enterprise) */}
      <section className="hp-enterprise-wrap">
        <div className="hp-enterprise-card">
          <div className="hp-prism-backdrop" />
          <div className="hp-enterprise-copy">
            <h2>{t('Bigger scale. Cleaner evidence.', '更大监测规模，更干净的证据链。')}</h2>
            <p>
              {t(
                'Built for research teams who refuse opaque metrics. Enforce role-based access, optimistic revision locks, and strict sample coverage disclosures across every chart.',
                '专为追求可验证证据的研究团队打造：原生具备三角色 RBAC、乐观锁并发保护与透明的已存样本统计口径。',
              )}
            </p>
            <button
              type="button"
              className="sr-btn sr-btn--outline-light"
              onClick={() => onEnterWorkbench('/projects')}
            >
              {t('Launch Workbench', '打开分析工作台')}
            </button>
          </div>

          <div className="hp-enterprise-mock">
            <div className="hp-enterprise-app">
              <div className="hp-ent-rail">
                <SiftlineLogo size={20} showWordmark={false} />
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(var(--accent-rgb), 0.35)' }} />
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.08)' }} />
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.08)' }} />
              </div>
              <div className="hp-ent-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 16 }}>Project Overview · Cloud FinOps</strong>
                  <span className="wb-pill wb-pill--green">stored_sample</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <div style={{ background: '#fff', border: '1px solid #e3e7e4', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Thread Anchors</div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>2,481</div>
                  </div>
                  <div style={{ background: '#fff', border: '1px solid #e3e7e4', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Pain Hits</div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--purple)' }}>418</div>
                  </div>
                  <div style={{ background: '#fff', border: '1px solid #e3e7e4', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Active Providers</div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--teal)' }}>4 / 7</div>
                  </div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e3e7e4', borderRadius: 6, padding: 14, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Benchmark · Signal Share by Source</div>
                  <svg viewBox="0 0 420 120" style={{ width: '100%', height: 'auto' }}>
                    <line x1="10" y1="25" x2="410" y2="25" stroke="#eef1ef" />
                    <line x1="10" y1="60" x2="410" y2="60" stroke="#eef1ef" />
                    <line x1="10" y1="95" x2="410" y2="95" stroke="#eef1ef" />
                    <path d="M 16 74 L 78 64 L 140 69 L 204 42 L 268 48 L 332 28 L 402 22" fill="none" stroke="var(--purple)" strokeWidth="2.4" />
                    <path d="M 16 86 L 78 82 L 140 76 L 204 72 L 268 62 L 332 58 L 402 49" fill="none" stroke="var(--teal)" strokeWidth="2.2" />
                    <path d="M 16 90 L 78 88 L 140 85 L 204 81 L 268 78 L 332 74 L 402 70" fill="none" stroke="var(--apricot)" strokeWidth="2" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities / 9 Expandable Solutions Carousel (04-solutions & 16-solution-expanded) */}
      <section id="capabilities" className="hp-section">
        <div className="hp-section-top">
          <div>
            <div className="hp-eyebrow">
              {t('CAPABILITIES', '核心能力矩阵')} <span>( 9 )</span>
            </div>
            <h2 className="hp-h2-upper">
              {t('GET THE SIGNAL. FILTER THE NOISE. ACT FIRST.', '捕捉信号。过滤噪音。先人一步决策。')}
            </h2>
          </div>
          <div className="hp-circle-controls">
            <button
              type="button"
              className="hp-circle-btn"
              onClick={() => scrollTrack(solTrackRef, -1)}
              aria-label="Scroll capabilities left"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              className="hp-circle-btn"
              onClick={() => scrollTrack(solTrackRef, 1)}
              aria-label="Scroll capabilities right"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div ref={solTrackRef} className="hp-solutions-track">
          {SOLUTIONS_DATA.map((sol) => {
            const isOpen = expandedSol === sol.key;
            return (
              <article key={sol.key} className={`hp-sol-card ${isOpen ? 'expanded' : ''}`}>
                <div
                  className="sem-hatch-mint"
                  style={{ position: 'absolute', right: 0, bottom: 0, width: 320, height: 240, pointerEvents: 'none' }}
                />
                <div className="hp-sol-card-head">
                  <div>
                    <div className="hp-sol-tag">{sol.tag}</div>
                    <h3 className="hp-sol-title">{lang === 'zh' ? sol.titleZh : sol.titleEn}</h3>
                  </div>
                  <button
                    type="button"
                    className="hp-sol-toggle"
                    onClick={() => setExpandedSol(isOpen ? null : sol.key)}
                    aria-label={isOpen ? 'Collapse capability card' : 'Expand capability card'}
                    aria-expanded={isOpen}
                  >
                    <Plus size={18} />
                  </button>
                </div>

                <div className="hp-sol-body">
                  {isOpen && (
                    <div className="hp-sol-extra">
                      <p>{lang === 'zh' ? sol.descZh : sol.descEn}</p>
                      <div>
                        <button
                          type="button"
                          className="sr-btn sr-btn--dark"
                          onClick={() => onEnterWorkbench(sol.route)}
                        >
                          {t('Open Module', '打开对应面板')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="hp-sol-mock-frame">
                    <MiniCardVisual type={sol.chartType} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Stats & Facts Interactive Highlight Rows (05-stats-top & 06-stats-bottom) */}
      <section id="stats" className="hp-section" style={{ paddingTop: 28 }}>
        <div className="hp-section-top">
          <div>
            <div className="hp-eyebrow">{t('STATS AND FACTS', '系统基线与指标')}</div>
            <h2 className="hp-h2-upper">
              {t('THE ARCHITECTURE BUILT FOR EVIDENCE-FIRST RESEARCH', '为高保真证据研究而生的工程底座')}
            </h2>
          </div>
          <button
            type="button"
            className="sr-btn sr-btn--outline"
            onClick={() => onEnterWorkbench('/settings')}
          >
            {t('Inspect Contracts', '查看系统契约')}
          </button>
        </div>

        <div className="hp-stats-list">
          {STATS_DATA.map((st, idx) => (
            <div
              key={st.num + idx}
              className={`hp-stat-row ${activeStat === idx ? 'active' : ''}`}
              onMouseEnter={() => setActiveStat(idx)}
              onClick={() => setActiveStat(idx)}
            >
              <div className="hp-stat-box">
                <div className="hp-stat-arrow">
                  <ArrowUp size={56} strokeWidth={2.4} />
                </div>
                <div className="hp-stat-num-panel">
                  <div className="hp-stat-num tabular-nums">{st.num}</div>
                  <div className="hp-stat-label">{lang === 'zh' ? st.labelZh : st.labelEn}</div>
                </div>
              </div>
              <p className="hp-stat-desc">{lang === 'zh' ? st.descZh : st.descEn}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Dark Community Signal Visibility Index (07-ai-index-top & 08-ai-index-ranking) */}
      <section id="index" className="hp-index-band">
        <div className="hp-index-curtain" />
        <div className="hp-index-inner">
          <div className="hp-sparkle-badge">
            <Sparkles size={38} color="var(--white)" />
          </div>
          <h2 className="hp-index-title">
            {t('COMMUNITY SIGNAL INDEX', '社区讨论信号指数')}
          </h2>
          <p className="hp-index-sub">
            {t(
              'Explore where engineering pain points and product friction surface first across stored-sample channels.',
              '实时观测产品痛点与技术摩擦最先爆发的社区阵地（基于已存样本口径）。',
            )}
          </p>
          <button
            type="button"
            className="sr-btn sr-btn--wisteria"
            onClick={() => onEnterWorkbench('/content?signal=pain')}
          >
            {t('Explore pain signals', '探索痛点信号')} <ArrowUpRight size={16} />
          </button>

          <div className="hp-leaderboard">
            <div className="hp-lb-head">
              <span>{t('Community / Source', '社区 / 监测来源')}</span>
              <span>{t('Signals', '命中数')}</span>
              <span className="hp-lb-meta">coverage: stored_sample · Nov 2026</span>
            </div>
            {INDEX_LEADERBOARD.map((row) => (
              <div key={row.community} className="hp-lb-row">
                <span style={{ fontWeight: 500 }}>{row.community}</span>
                <span className="tabular-nums" style={{ fontWeight: 600 }}>{row.mentions}</span>
                <div className="hp-lb-bar-track">
                  <div
                    className="hp-lb-bar"
                    style={{
                      width: `${row.pct}%`,
                      background: palette.hasGradient
                        ? `linear-gradient(90deg, ${row.color} 0%, rgba(255,255,255,0.22) 100%)`
                        : row.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Customer Testimonials Asymmetric Row (09-customers) */}
      <section className="hp-section">
        <div className="hp-section-top">
          <div>
            <div className="hp-eyebrow">{t('RESEARCH TEAMS', '研究团队实战反馈')}</div>
            <h2 className="hp-h2-upper">
              {t('HOW ANALYSTS TURN NOISE INTO CONVICTION', '研究团队如何将舆论噪音转化为产品笃定')}
            </h2>
          </div>
          <div className="hp-circle-controls">
            <button
              type="button"
              className="hp-circle-btn"
              onClick={() => setQuoteIdx((i) => (i - 1 + TESTIMONIALS.length) % TESTIMONIALS.length)}
              aria-label="Previous testimonial"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              className="hp-circle-btn"
              onClick={() => setQuoteIdx((i) => (i + 1) % TESTIMONIALS.length)}
              aria-label="Next testimonial"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div className="hp-customer-grid">
          <article className="hp-quote-card">
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', opacity: 0.85 }}>
              {curQuote.company}
            </div>
            <p className="hp-quote-text">
              <span className="hp-quote-mark">“</span>
              {lang === 'zh' ? curQuote.quoteZh : curQuote.quoteEn}
            </p>
            <div className="hp-quote-author">
              <div className="hp-avatar-pill">{curQuote.initials}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{curQuote.author}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{curQuote.role}</div>
              </div>
            </div>
          </article>

          <article className="hp-impact-card">
            <div className="hp-promo-hatch sem-hatch-wisteria" />
            <div className="hp-impact-num tabular-nums">{curQuote.metric}</div>
            <div style={{ fontSize: 15, color: 'var(--ink-70)', maxWidth: 230, position: 'relative', zIndex: 2 }}>
              {lang === 'zh' ? curQuote.metricLabelZh : curQuote.metricLabelEn}
            </div>
          </article>
        </div>
      </section>

      {/* Resources Horizontal Carousel (10-resources) */}
      <section className="hp-section" style={{ paddingTop: 12 }}>
        <div className="hp-section-top">
          <div>
            <div className="hp-eyebrow">
              {t('RESOURCES', '方法论与指南')} <span>( {RESOURCES_DATA.length} )</span>
            </div>
            <h2 className="hp-h2-upper">
              {t('STAY AHEAD OF WHAT MATTERS', '紧跟真实信号研究范式')}
            </h2>
          </div>
          <div className="hp-circle-controls">
            <button
              type="button"
              className="hp-circle-btn"
              onClick={() => scrollTrack(resTrackRef, -1)}
              aria-label="Scroll resources left"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              className="hp-circle-btn"
              onClick={() => scrollTrack(resTrackRef, 1)}
              aria-label="Scroll resources right"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div ref={resTrackRef} className="hp-resources-track">
          {RESOURCES_DATA.map((res, idx) => (
            <article
              key={idx}
              className="hp-res-card"
              onClick={() => onEnterWorkbench('/projects')}
            >
              <div
                className="hp-res-cover"
                style={{
                  background:
                    res.tone === 'dark'
                      ? 'var(--dark-section-bg)'
                      : res.tone === 'wisteria'
                        ? 'var(--res-wisteria-bg)'
                        : 'var(--res-opal-bg)',
                  color:
                    res.tone === 'dark'
                      ? 'var(--white)'
                      : res.tone === 'wisteria'
                        ? 'var(--on-accent)'
                        : 'var(--ink)',
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <SiftlineLogo size={20} fontSize={14} />
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>0{idx + 1}</span>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>
                  {res.tags[0]}
                </div>
              </div>
              <h3>{lang === 'zh' ? res.titleZh : res.titleEn}</h3>
              <p>{lang === 'zh' ? res.descZh : res.descEn}</p>
              <div className="hp-res-tags">
                {res.tags.map((tg) => (
                  <span key={tg}>{tg}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Signature Semrush Footer (11-footer) */}
      <footer className="hp-footer">
        <div className="hp-footer-grid">
          <div className="hp-footer-cta">
            <h3>{t('Get started with Siftline today', '立即开始使用 Siftline 工作台')}</h3>
            <p>
              {t(
                'Explore stored-sample projects, thread trees, and source budgets right in the browser.',
                '无需等待后端部署即可预览项目监测、评论树与渠道预算全景。',
              )}
            </p>
            <button
              type="button"
              className="sr-btn sr-btn--wisteria"
              onClick={() => onEnterWorkbench('/projects')}
            >
              {t('Open Live Workbench', '进入信息工作台')}
            </button>
          </div>

          <div className="hp-footer-col">
            <h5>{t('Workbench', '核心工作台')}</h5>
            <ul>
              <li><button onClick={() => onEnterWorkbench('/projects')}>{t('Monitoring Projects', '监测项目面板')}</button></li>
              <li><button onClick={() => onEnterWorkbench('/content')}>{t('Content Explorer', '内容检索与评论树')}</button></li>
              <li><button onClick={() => onEnterWorkbench('/sources')}>{t('Sources & Budgets', '来源采集与预算')}</button></li>
              <li><button onClick={() => onEnterWorkbench('/workspace')}>{t('Personal Workspace', '个人查询与批注')}</button></li>
            </ul>
          </div>

          <div className="hp-footer-col">
            <h5>{t('Collection Ops', '采集管道')}</h5>
            <ul>
              <li><button onClick={() => onEnterWorkbench('/sources')}>Reddit · kaix / red_crawler</button></li>
              <li><button onClick={() => onEnterWorkbench('/sources')}>X · twitterapis / scrapebadger</button></li>
              <li><button onClick={() => onEnterWorkbench('/sources')}>Bluesky AppView</button></li>
              <li><button onClick={() => onEnterWorkbench('/sources')}>Push Ingest (external_ingest)</button></li>
            </ul>
          </div>

          <div className="hp-footer-col">
            <h5>{t('Access & Security', '鉴权与契约')}</h5>
            <ul>
              <li><button onClick={() => onOpenAuth('login')}>{t('Sign In (app_session)', '会话登录')}</button></li>
              <li><button onClick={() => onOpenAuth('register')}>{t('Invite Registration', '邀请码注册')}</button></li>
              <li><button onClick={() => onEnterWorkbench('/settings')}>{t('Machine API Keys', '机器 API 密钥')}</button></li>
              <li><button onClick={() => setSwitcherOpen(true)}>{t('Logo Explorer (30)', '图标切换器 (30)')}</button></li>
              <li><button onClick={() => setStudioOpen(true)}>{t('Color Palette Studio', '配色替换工作台')}</button></li>
            </ul>
          </div>

          <div className="hp-footer-col">
            <h5>{t('Language', '界面语言')}</h5>
            <ul>
              <li><button onClick={() => setLang('en')}>English (US)</button></li>
              <li><button onClick={() => setLang('zh')}>简体中文 (ZH)</button></li>
            </ul>
          </div>
        </div>

        <div className="hp-footer-legal">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <SiftlineLogo size={22} fontSize={16} />
            <span>© 2026 SIFTLINE · Contract-aligned Frontend Prototype (prod@dd2feb2)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <span>Active Mark: {activeLogo.num} / {activeLogo.name}</span>
            <button
              type="button"
              className="hp-lang-chip"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            >
              {lang === 'en' ? 'English ▾' : '简体中文 ▾'}
            </button>
          </div>
        </div>

        <div className="hp-footer-wordmark-band">
          <div className="hp-footer-lines" />
          <div className="hp-giant-wordmark">SIFTLINE</div>
        </div>
      </footer>
    </div>
  );
}
