import { useMemo, useState } from 'react';
import { Check, Copy, Database, Terminal } from 'lucide-react';
import { useI18n } from '../i18n/translations';

interface R4ArchivePanelProps {
  sourceId: string;
}

function shellQuotePs(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuoteSh(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function toUtcIsoOrEmpty(localValue: string): string {
  if (!localValue.trim()) return '';
  const dt = new Date(localValue);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString();
}

export function R4ArchivePanel({ sourceId }: R4ArchivePanelProps) {
  const { t } = useI18n();
  const [action, setAction] = useState<'push' | 'query' | 'inspect'>('push');
  const [shellKind, setShellKind] = useState<'powershell' | 'bash'>('powershell');
  const [archiveRoot, setArchiveRoot] = useState('./open-packages');
  const [monthMode, setMonthMode] = useState<'all' | 'custom'>('all');
  const [monthsText, setMonthsText] = useState('2026-08,2026-09,2026-10');
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [queryText, setQueryText] = useState('chatgpt OR llm OR claude');
  const [subredditsText, setSubredditsText] = useState('');
  const [limit, setLimit] = useState(50);
  const [maxComments, setMaxComments] = useState(10);
  const [apiUrl, setApiUrl] = useState('http://127.0.0.1:3000');
  const [dryRun, setDryRun] = useState(false);
  const [resume, setResume] = useState(true);
  const [copied, setCopied] = useState(false);

  const toggleMonthChip = (m: string) => {
    if (monthMode === 'all') {
      setMonthsText(m);
      setMonthMode('custom');
      return;
    }
    const parts = monthsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const next = parts.includes(m) ? parts.filter((x) => x !== m) : [...parts, m].sort();
    if (next.length === 0) {
      setMonthMode('all');
      return;
    }
    setMonthsText(next.join(','));
  };

  const selectedMonths = useMemo(
    () =>
      monthsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [monthsText],
  );

  const commandText = useMemo(() => {
    const q = shellKind === 'powershell' ? shellQuotePs : shellQuoteSh;
    const args: string[] = ['python', '-m', 'zst_archive', action, '--archive-root', q(archiveRoot.trim() || './open-packages')];

    if (monthMode === 'custom' && selectedMonths.length > 0) {
      args.push('--months', q(selectedMonths.join(',')));
    }

    if (action !== 'inspect') {
      if (queryText.trim()) args.push('--query', q(queryText.trim()));
      if (subredditsText.trim()) args.push('--subreddits', q(subredditsText.trim()));
      const fromIso = toUtcIsoOrEmpty(fromLocal);
      const toIso = toUtcIsoOrEmpty(toLocal);
      if (fromIso) args.push('--from', q(fromIso));
      if (toIso) args.push('--to', q(toIso));
      args.push('--limit', String(Math.max(1, limit || 50)));
      args.push('--max-comments-per-post', String(Math.max(0, maxComments)));
      if (!queryText.trim() && !subredditsText.trim()) {
        args.push('--allow-unscoped');
      }
    }

    if (action === 'push') {
      args.push('--source-id', sourceId);
      args.push('--api-url', q(apiUrl.trim() || 'http://127.0.0.1:3000'));
      if (dryRun) args.push('--dry-run');
      if (!resume) args.push('--no-resume');
    }

    if (shellKind === 'powershell') {
      const envPrefix = [
        '$env:PYTHONPATH = "plugins/zst-archive"',
        ...(action === 'push' && !dryRun ? ['$env:ARCHIVE_INGEST_TOKEN = "<PASTE_MACHINE_TOKEN>"'] : []),
      ];
      return [...envPrefix, args.join(' ')].join('\n');
    }

    const prefix = action === 'push' && !dryRun
      ? 'ARCHIVE_INGEST_TOKEN="<PASTE_MACHINE_TOKEN>" PYTHONPATH=plugins/zst-archive '
      : 'PYTHONPATH=plugins/zst-archive ';
    return `${prefix}${args.join(' ')}`;
  }, [
    action,
    apiUrl,
    archiveRoot,
    dryRun,
    fromLocal,
    limit,
    maxComments,
    monthMode,
    queryText,
    resume,
    selectedMonths,
    shellKind,
    sourceId,
    subredditsText,
    toLocal,
  ]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(commandText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ background: '#f7f8f3', border: '1px solid var(--line)', borderRadius: 8, padding: 13, display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
            <Database size={14} color="var(--wb-purple)" />
            <span>{t('R4 Offline Archive Collection Console (open-corpus-v1)', 'R4 离线归档检索与推流控制台 (open-corpus-v1)')}</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0', lineHeight: 1.55 }}>
            {t(
              'A single push source accepts samples from multiple archive months (e.g. 2026-08, 2026-09, 2026-10). DuckDB + FTS5 queries across selected months locally and pushes batches into this sourceId.',
              '说明：同一离线归档（push）来源可统一接收多月归档数据（如 2026-08 / 2026-09 / 2026-10），无需按月拆源；外挂插件通过 FTS5 + DuckDB 联合筛选并统一推流至当前来源。',
            )}
          </p>
        </div>
        <span className="tag tag--lilac" style={{ height: 20, fontSize: 9.5 }}>
          sourceId: {sourceId.slice(0, 8)}…
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div className="seg">
          <button type="button" className={action === 'push' ? 'on' : ''} onClick={() => setAction('push')}>
            {t('Push to DB (push)', '检索并推流入库 (push)')}
          </button>
          <button type="button" className={action === 'query' ? 'on' : ''} onClick={() => setAction('query')}>
            {t('Local Preview (query)', '仅本地试搜 (query)')}
          </button>
          <button type="button" className={action === 'inspect' ? 'on' : ''} onClick={() => setAction('inspect')}>
            {t('Scan Packages (inspect)', '扫描归档包 (inspect)')}
          </button>
        </div>

        <div className="seg">
          <button type="button" className={shellKind === 'powershell' ? 'on' : ''} onClick={() => setShellKind('powershell')}>
            PowerShell
          </button>
          <button type="button" className={shellKind === 'bash' ? 'on' : ''} onClick={() => setShellKind('bash')}>
            Bash
          </button>
        </div>
      </div>

      <div className="wb-grid-2">
        <div className="wb-field">
          <label>{t('Archive Root (--archive-root)', '离线归档根目录 (--archive-root)')}</label>
          <input
            className="wb-input"
            value={archiveRoot}
            onChange={(e) => setArchiveRoot(e.target.value)}
            placeholder="./open-packages"
          />
        </div>
        <div className="wb-field">
          <label>{t('Month Scope (--months)', '纳入检索的归档月份范围')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={`ds-btn ${monthMode === 'all' ? '' : 'ds-btn--ghost'}`}
              style={{ height: 28, fontSize: 11, padding: '0 10px' }}
              onClick={() => setMonthMode('all')}
            >
              {t('All Months', '全部可用月份')}
            </button>
            {(['2026-08', '2026-09', '2026-10'] as const).map((m) => {
              const active = monthMode === 'custom' && selectedMonths.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  className={`ds-btn ${active ? '' : 'ds-btn--ghost'}`}
                  style={{ height: 28, fontSize: 11, padding: '0 9px' }}
                  onClick={() => toggleMonthChip(m)}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {monthMode === 'custom' && (
        <div className="wb-field">
          <label>{t('Selected Months CSV', '自定义月份列表 (逗号分隔 YYYY-MM)')}</label>
          <input
            className="wb-input"
            value={monthsText}
            onChange={(e) => setMonthsText(e.target.value)}
            placeholder="2026-08,2026-09,2026-10"
          />
        </div>
      )}

      {action !== 'inspect' && (
        <>
          <div className="wb-grid-2">
            <div className="wb-field">
              <label>{t('Boolean Query (--query)', '布尔检索词 (--query)')}</label>
              <input
                className="wb-input"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder='chatgpt OR "coding agent"'
              />
            </div>
            <div className="wb-field">
              <label>{t('Subreddits (--subreddits, optional)', '限定版块 (--subreddits，留空查全站)')}</label>
              <input
                className="wb-input"
                value={subredditsText}
                onChange={(e) => setSubredditsText(e.target.value)}
                placeholder="localllama,chatgpt"
              />
            </div>
          </div>

          <div className="wb-grid-2">
            <div className="wb-field">
              <label>{t('From UTC (--from, optional)', '起始发布时间 UTC (--from，可选)')}</label>
              <input type="datetime-local" className="wb-input" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
            </div>
            <div className="wb-field">
              <label>{t('To UTC (--to, optional)', '截止发布时间 UTC (--to，可选)')}</label>
              <input type="datetime-local" className="wb-input" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
            </div>
          </div>

          <div className="wb-grid-2">
            <div className="wb-field">
              <label>{t('Max Matched Posts (--limit)', '主帖上限 (--limit)')}</label>
              <input
                type="number"
                className="wb-input"
                min={1}
                max={2000}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="wb-field">
              <label>{t('Comments / Post (--max-comments-per-post)', '每帖携带精选评论 (--max-comments-per-post)')}</label>
              <input
                type="number"
                className="wb-input"
                min={0}
                max={50}
                value={maxComments}
                onChange={(e) => setMaxComments(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>
        </>
      )}

      {action === 'push' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="wb-field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <label>{t('API Base URL (--api-url)', '后端入库地址 (--api-url)')}</label>
            <input className="wb-input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11.5, paddingTop: 14 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              <span>--dry-run ({t('Plan only', '仅预演不入库')})</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} />
              <span>--resume ({t('Skip sent', '账本续传')})</span>
            </label>
          </div>
        </div>
      )}

      {action !== 'inspect' && monthMode === 'all' && !toLocal && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', background: '#fff', border: '1px dashed var(--line)', borderRadius: 5, padding: '6px 9px' }}>
          {t(
            'Tip: DuckDB sorts matched posts newest-first (created_utc DESC) up to --limit. To sample evenly across 2026-08 / 09 / 10 into this same sourceId, set --from/--to windows or select each month once.',
            '提示：跨月全选时 DuckDB 默认按最新时间倒序截取前 N 帖；若希望 2026-08 / 09 / 10 各月均匀入库至当前同一个来源，可配合时间窗口分批推入，或依次点选单个月份推入同一 sourceId。',
          )}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
            <Terminal size={12} />
            {t('Generated CLI Command (run locally with ingest + read key from Settings)', '生成的本地插件执行命令（需在「账户与权限 → 机器 API 密钥」生成绑定此来源的密钥）')}
          </span>
          <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 11, padding: '0 9px' }} onClick={handleCopy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? t('Copied', '已复制') : t('Copy Command', '复制命令')}</span>
          </button>
        </div>
        <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.55, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, padding: 10, overflowX: 'auto' }}>
          {commandText}
        </pre>
      </div>
    </div>
  );
}
