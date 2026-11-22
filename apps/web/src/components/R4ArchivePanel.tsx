import { useMemo, useState } from 'react';
import { Check, Copy, Database, Terminal } from 'lucide-react';
import { useI18n } from '../i18n/translations';
import { toSafeUtcIso } from '../lib/sourceLabels';

interface R4ArchivePanelProps {
  sourceId: string;
  active: boolean;
}

function shellQuotePs(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuoteSh(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function R4ArchivePanel({ sourceId, active }: R4ArchivePanelProps) {
  const { t } = useI18n();
  const [action, setAction] = useState<'push' | 'query' | 'inspect'>(active ? 'push' : 'inspect');
  const [shellKind, setShellKind] = useState<'powershell' | 'bash'>('powershell');
  const [archiveRoot, setArchiveRoot] = useState('./open-packages');
  const [monthMode, setMonthMode] = useState<'all' | 'custom'>('all');
  const [monthsText, setMonthsText] = useState('');
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [queryText, setQueryText] = useState('chatgpt OR llm OR claude');
  const [subredditsText, setSubredditsText] = useState('');
  const [limit, setLimit] = useState(50);
  const [maxComments, setMaxComments] = useState(10);
  const [apiUrl, setApiUrl] = useState(() => (window.location.origin + '/api'));
  const [dryRun, setDryRun] = useState(true);
  const [resume, setResume] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const selectedMonths = useMemo(
    () =>
      monthsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [monthsText],
  );
  const fromIso = toSafeUtcIso(fromLocal);
  const toIso = toSafeUtcIso(toLocal);
  const invalidWindow = action !== 'inspect' &&
    ((fromLocal && !fromIso) || (toLocal && !toIso) || (fromIso && toIso && fromIso >= toIso));
  const invalidMonths = monthMode === 'custom' &&
    (!selectedMonths.length || selectedMonths.some(month => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)));
  const commandBlocked = Boolean(invalidWindow || invalidMonths || (action === 'push' && !active));

  const commandText = useMemo(() => {
    const q = shellKind === 'powershell' ? shellQuotePs : shellQuoteSh;
    const args: string[] = ['python', '-m', 'zst_archive', action, '--archive-root', q(archiveRoot.trim() || './open-packages')];

    if (monthMode === 'custom' && selectedMonths.length > 0) {
      args.push('--months', q(selectedMonths.join(',')));
    }

    if (action !== 'inspect') {
      if (queryText.trim()) args.push('--query', q(queryText.trim()));
      if (subredditsText.trim()) args.push('--subreddits', q(subredditsText.trim()));
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
      args.push('--api-url', q(apiUrl.trim() || (window.location.origin + '/api')));
      if (dryRun) args.push('--dry-run');
      if (!resume) args.push('--no-resume');
    }

    if (shellKind === 'powershell') {
      const lines = ['$env:PYTHONPATH = "plugins/zst-archive"'];
      if (action === 'push' && !dryRun) lines.push('$env:ARCHIVE_INGEST_TOKEN = "<paste-scoped-ingest-machine-key>"');
      lines.push(args.join(' '));
      return lines.join('\n');
    }

    const prefix = action === 'push' && !dryRun
      ? 'ARCHIVE_INGEST_TOKEN="<paste-scoped-ingest-machine-key>" PYTHONPATH=plugins/zst-archive '
      : 'PYTHONPATH=plugins/zst-archive ';
    return `${prefix}${args.join(' ')}`;
  }, [
    action,
    apiUrl,
    archiveRoot,
    dryRun,
    fromIso,
    limit,
    maxComments,
    monthMode,
    queryText,
    resume,
    selectedMonths,
    shellKind,
    sourceId,
    subredditsText,
    toIso,
  ]);

  const handleCopy = async () => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(commandText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <div className="collection-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
            <Database size={14} color="var(--wb-purple)" />
            <span>{t('R4 Offline Archive Collection Console (open-corpus-v1)', 'R4 离线归档检索与推流控制台 (open-corpus-v1)')}</span>
          </div>
          <p className="collection-hint">
            {t(
              'Install the external Python/DuckDB plugin on the archive host and run inspect to check local packages. The workbench cannot detect that installation or its available months. For live push, set ARCHIVE_INGEST_TOKEN on that host using a Machine Key with ingest scope restricted to this source.',
              '请在归档主机安装独立的 Python/DuckDB 插件，并运行 inspect 检查本地归档包。工作台无法检测插件安装或可用月份。正式推流前，请在归档主机设置 ARCHIVE_INGEST_TOKEN，使用仅允许当前来源且具备 ingest scope 的 Machine Key。',
            )}
          </p>
        </div>
        <span className="tag tag--lilac" style={{ height: 20, fontSize: 9.5 }}>
          sourceId: {sourceId.slice(0, 8)}…
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div className="seg">
          <button type="button" disabled={!active} className={action === 'push' ? 'on' : ''} onClick={() => setAction('push')}>
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
          <label htmlFor="archive-root">{t('Archive Root (--archive-root)', '离线归档根目录 (--archive-root)')}</label>
          <input
            className="wb-input"
            id="archive-root" value={archiveRoot}
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
            <button type="button" className={'ds-btn ' + (monthMode === 'all' ? 'ds-btn--ghost' : '')}
              onClick={() => setMonthMode('custom')}>{t('Choose months', '自定义月份')}</button>
          </div>
        </div>
      </div>

      {monthMode === 'custom' && (
        <div className="wb-field">
          <label htmlFor="r4-months">{t('Selected Months CSV', '自定义月份列表 (逗号分隔 YYYY-MM)')}</label>
          <input
            className="wb-input"
            id="r4-months"
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
              <label htmlFor="archive-query">{t('Boolean Query (--query)', '布尔检索词 (--query)')}</label>
              <input
                className="wb-input"
                id="archive-query" value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder='chatgpt OR "coding agent"'
              />
            </div>
            <div className="wb-field">
              <label htmlFor="archive-subreddits">{t('Subreddits (--subreddits, optional)', '限定版块 (--subreddits，留空查全站)')}</label>
              <input
                className="wb-input"
                id="archive-subreddits" value={subredditsText}
                onChange={(e) => setSubredditsText(e.target.value)}
                placeholder="localllama,chatgpt"
              />
            </div>
          </div>

          <div className="wb-grid-2">
            <div className="wb-field">
              <label htmlFor="r4-from">{t('From UTC (--from, optional)', '起始发布时间 UTC (--from，可选)')}</label>
              <input id="r4-from" type="datetime-local" className="wb-input" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
            </div>
            <div className="wb-field">
              <label htmlFor="r4-to">{t('To UTC (--to, optional)', '截止发布时间 UTC (--to，可选)')}</label>
              <input id="r4-to" type="datetime-local" className="wb-input" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
            </div>
          </div>

          <div className="wb-grid-2">
            <div className="wb-field">
              <label htmlFor="archive-limit">{t('Max Matched Posts (--limit)', '主帖上限 (--limit)')}</label>
              <input
                type="number"
                className="wb-input"
                min={1}
                max={2000}
                id="archive-limit" value={limit}
                onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="wb-field">
              <label htmlFor="archive-comments">{t('Comments / Post (--max-comments-per-post)', '每帖携带精选评论 (--max-comments-per-post)')}</label>
              <input
                type="number"
                className="wb-input"
                min={0}
                max={50}
                id="archive-comments" value={maxComments}
                onChange={(e) => setMaxComments(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>
        </>
      )}

      {action === 'push' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="wb-field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <label htmlFor="archive-api">{t('API Base URL (--api-url)', '后端入库地址 (--api-url)')}</label>
            <input className="wb-input" id="archive-api" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
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
            'Tip: DuckDB sorts matched posts newest-first (created_utc DESC) up to --limit. To sample across several months, use separate --from/--to windows or run each month individually.',
            '提示：跨月全选时 DuckDB 默认按最新时间倒序截取前 N 帖；如需覆盖多个月份，可分时间窗口或逐月运行。',
          )}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
            <Terminal size={12} />
            {t('Run this command on the archive host', '请在归档主机运行此命令')}
          </span>
          <button type="button" disabled={commandBlocked} className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 11, padding: '0 9px' }} onClick={handleCopy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? t('Copied', '已复制') : t('Copy Command', '复制命令')}</span>
          </button>
        </div>
        {!active && <p>{t('Activate this source to generate a push command.', '启用当前来源后即可生成推流命令。')}</p>}
        {invalidWindow && <p role="alert">{t('Enter a valid UTC window with start before end.', '请输入开始早于结束的有效 UTC 时间范围。')}</p>}
        {invalidMonths && <p role="alert">{t('Enter valid months in YYYY-MM format.', '请输入有效的 YYYY-MM 月份。')}</p>}
        {copyError && <p role="status">{t('Clipboard unavailable. Select and copy the command below.', '剪贴板不可用，请选中下方命令并手动复制。')}</p>}
        {!commandBlocked && <pre className="collection-code">
          {commandText}
        </pre>}
      </div>
    </div>
  );
}
