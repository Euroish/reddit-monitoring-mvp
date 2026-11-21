import { ArrowUpRight, BookOpen, Database, FolderKanban, Lock, Search, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/translations';

interface DocsPageProps {
  onNavigate: (path: string) => void;
  onOpenWorkbench: (targetPath?: string) => void;
}

export function DocsPage({ onNavigate, onOpenWorkbench }: DocsPageProps) {
  const { t } = useI18n();

  const sections = [
    {
      id: 'quickstart',
      icon: BookOpen,
      title: t('Product Quickstart', '产品快速入门'),
      desc: t(
        'SIFTLINE separates lightweight public reading (/) from the full monitoring workbench (/app/feed, /projects, /content, /sources). Start reading live stories immediately or sign in to create tracked projects.',
        'SIFTLINE 将轻量公开阅读首页（/）与专业研究工作台（/app/feed、/projects、/content、/sources）清晰分离。访客可直接阅读公开信息流，登录后即可创建监测项目与个人研究记录。',
      ),
      actionLabel: t('Open Public Feed', '前往公开信息首页'),
      onAction: () => onNavigate('/'),
    },
    {
      id: 'feed',
      icon: BookOpen,
      title: t('Stories Feed & Digest', '信息流阅读与 08:00 日报'),
      desc: t(
        'Stories deduplicate cross-source coverage and elect a primary report by source tier (T1 > T1.5 > T2). Switch between Today, 48h Momentum, and 08:00 Daily Digest in /app/feed with j/k/m keyboard shortcuts.',
        'Stories 对跨来源重复报道进行聚簇，按 T1 > T1.5 > T2 选举一手代表报道；在 /app/feed 支持今日精选、48 小时热度与 08:00 日报回溯，并支持 j/k/m 键盘速读与 Markdown 复制。',
      ),
      actionLabel: t('Open /app/feed', '打开完整信息流'),
      onAction: () => onNavigate('/app/feed'),
    },
    {
      id: 'explorer',
      icon: Search,
      title: t('Content Explorer & Facets', '深度检索与分面分析'),
      desc: t(
        'Filter stored content by boolean terms, pain signals, platform, source, and UTC time windows. Use Analyze Content (/v1/content/facets) for real daily/platform breakdowns and inspect nested 3-view thread trees.',
        '支持布尔词组、痛点信号、平台、来源与 UTC 时间窗口检索；点击「分析内容」可调用真实 /v1/content/facets 渲染按日与平台分布，并查看三视图讨论评论树。',
      ),
      actionLabel: t('Open Content Explorer', '进入内容检索'),
      onAction: () => onNavigate('/content'),
    },
    {
      id: 'projects',
      icon: FolderKanban,
      title: t('Monitoring Projects', '专题项目监测'),
      desc: t(
        'Bind selected sources and filters into a tracked project to monitor UTC daily facets without zero-filling uncollected gaps. Drill down directly from any day/platform bar into matching source records.',
        '将指定来源与过滤规则组合为监测项目，按 UTC 日分桶展示真实命中趋势（未采集区间绝不补零），支持点击任意柱体下钻至原始记录。',
      ),
      actionLabel: t('Open Projects', '进入监测项目'),
      onAction: () => onOpenWorkbench('/projects'),
    },
    {
      id: 'sources',
      icon: Database,
      title: t('Sources, Pull & Push Ingest', '来源接入、主动采集与推流'),
      desc: t(
        'Manage Web RSS/NewsNow, Bluesky, Reddit, and X sources under capability-driven limits and conservative daily quotas. Push sources support canonical JSON batch import (up to 1 MiB / 100 items) with Idempotency-Key protection.',
        '按服务端能力矩阵与保守日配额管理 Web RSS/NewsNow、Bluesky、Reddit 与 X 采集源；Push 来源支持携带 Idempotency-Key 的规范 JSON 批量导入（单批上限 1 MiB / 100 条）。',
      ),
      actionLabel: t('Open Sources', '进入来源管理'),
      onAction: () => onOpenWorkbench('/sources'),
    },
    {
      id: 'access',
      icon: Lock,
      title: t('Accounts, RBAC & Machine Keys', '账户、角色权限与机器密钥'),
      desc: t(
        'Browser sessions use same-origin HttpOnly cookies with Owner, Admin, and Viewer roles. External scripts can be granted source-scoped Machine Keys with explicit read/ingest/export permissions.',
        '浏览器会话采用同源 HttpOnly Cookie，内置 Owner、Admin、Viewer 三角色隔离；外部采集脚本仅可使用限定来源与明确 scope（read/ingest/export）的机器 API 密钥。',
      ),
      actionLabel: t('Open Settings', '进入账户与权限'),
      onAction: () => onOpenWorkbench('/settings'),
    },
  ];

  return (
    <div className="pdoc-wrap">
      <div className="pih-hero" style={{ marginBottom: 22 }}>
        <span className="pih-eyebrow">
          <BookOpen size={12} />
          {t('Public Documentation', '公开产品文档')}
        </span>
        <h1>{t('SIFTLINE Documentation', 'SIFTLINE 使用与口径文档')}</h1>
        <p className="pih-hero-sub">
          {t(
            'Reference guide for public reading, content search, monitoring projects, source ingestion, and transparent stored-sample metrics.',
            '涵盖公开信息流阅读、深度检索、专题监测、来源接入、账户权限与透明样本口径的公开使用指南。',
          )}
        </p>
      </div>

      <div className="pdoc-grid">
        {sections.map((sec) => {
          const Icon = sec.icon;
          return (
            <article key={sec.id} id={sec.id} className="pdoc-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wb-teal, #1f7471)' }}>
                <Icon size={16} />
                <h3>{sec.title}</h3>
              </div>
              <p>{sec.desc}</p>
              <div>
                <button type="button" className="pih-link-btn" onClick={sec.onAction}>
                  <span>{sec.actionLabel}</span>
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <section id="coverage" className="pih-section" style={{ marginTop: 22 }}>
        <div className="pih-section-hd">
          <div>
            <h2 className="pih-section-title">
              <ShieldCheck size={16} color="var(--wb-teal, #1f7471)" />
              {t('Data Coverage & Source Tiers', '数据口径与来源分级说明')}
            </h2>
            <p className="pih-section-sub">
              {t('How SIFTLINE guarantees metric honesty across public and workbench views', 'SIFTLINE 在公开视图与工作台共同遵循的度量诚实性约定')}
            </p>
          </div>
        </div>
        <div id="tiers" style={{ display: 'grid', gap: 10, fontSize: 13.5, lineHeight: 1.65, color: '#3b473a' }}>
          <p style={{ margin: 0 }}>
            <strong>coverage: stored_sample</strong> —{' '}
            {t(
              'All counts, trends, and 48h momentum figures reflect only persisted records collected from configured sources—never claimed as full-internet coverage.',
              '所有条数、趋势与 48 小时热度均严格基于已配置来源的入库样本计算，绝不虚构全网覆盖率或未采集区间的补零数据。',
            )}
          </p>
          <p style={{ margin: 0 }}>
            <strong>T1 / T1.5 / T2</strong> —{' '}
            {t(
              'T1 represents primary official blogs and research releases; T1.5 represents developer communities and primary discussion hubs; T2 represents secondary tech media and aggregators.',
              'T1 代表一手官方博客与研究发布；T1.5 代表高密度开发者社区与讨论源；T2 代表科技媒体与二次报道聚合源。',
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
