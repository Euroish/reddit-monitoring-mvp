import { useState, type FormEvent } from 'react';
import { CalendarClock, Pause, Play, Plus, Trash2 } from 'lucide-react';
import {
  formatApiError,
  useCreateMonitorMutation,
  useDeleteMonitorMutation,
  useUpdateMonitorMutation,
} from '../api/hooks';
import type { Actor, IntelMonitorDto, Project, QuotasSummaryResponse } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function MonitorSchedulePanel({
  actor,
  project,
  quota,
  monitors,
}: {
  actor: Actor;
  project: Project;
  quota?: QuotasSummaryResponse;
  monitors: IntelMonitorDto[];
}) {
  const { t } = useI18n();
  const isAdmin = actor.clientKind === 'browser' && actor.role !== 'viewer';
  const ep = quota?.effectivePolicy;
  const allowSchedule = isAdmin || ep?.allowAutoSchedule === true;
  const minHours = isAdmin ? 1 : (ep?.minScheduleIntervalHours ?? 24);
  const canEditProject = actor.clientKind === 'browser' && Boolean(project.can_edit ?? isAdmin);

  const createMut = useCreateMonitorMutation();
  const updateMut = useUpdateMonitorMutation();
  const deleteMut = useDeleteMonitorMutation();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(`${project.name} schedule`);
  const [platform, setPlatform] = useState<'reddit' | 'x'>('reddit');
  const [keywordsRaw, setKeywordsRaw] = useState('');
  const [intervalHours, setIntervalHours] = useState(Math.max(24, minHours));
  const [dailyBudget, setDailyBudget] = useState(200);
  const [error, setError] = useState('');

  const boundMonitors = monitors.filter(
    (m) => m.projectId === project.id || project.linked_monitor_id === m.id,
  );
  if (!canEditProject && boundMonitors.length === 0) return null;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    const keywords = keywordsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!keywords.length) {
      setError(t('Enter at least one keyword.', '请至少填写一个监控关键词。'));
      return;
    }
    try {
      await createMut.mutateAsync({
        kind: 'keyword',
        name: name.trim() || `${project.name} Auto`,
        config: { platforms: [platform], keywords },
        scheduleIntervalHours: intervalHours,
        dailyItemBudget: dailyBudget,
        enabled: true,
        projectId: project.id,
      });
      setCreating(false);
      setKeywordsRaw('');
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  return (
    <section className="ds-card" style={{ marginBottom: 14 }}>
      <header className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <h3 className="ds-card-title">
            <CalendarClock size={14} />
            <span>{t('Continuous Scheduled Monitoring', '连续自动监测调度')}</span>
          </h3>
          <div className="ds-card-sub">
            {allowSchedule
              ? t(
                  `Bound auto-schedules for this project (supports 1..168h; min allowed: ${minHours}h).`,
                  `关联此项目的连续定时任务（支持 1..168 小时周期；当前最低允许 ${minHours} 小时）。`,
                )
              : t(
                  'Continuous scheduling is disabled for your plan tier; single-run collection remains available.',
                  '当前套餐仅开放单次手动采集，连续自动调度权限未开启。',
                )}
          </div>
        </div>
        {canEditProject && allowSchedule && !creating && (
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setCreating(true)}>
            <Plus size={13} />
            <span>{t('New Schedule', '新建连续调度')}</span>
          </button>
        )}
      </header>
      <div className="ds-card-bd">
        {error && <div className="wb-alert wb-alert--error" style={{ marginBottom: 10 }}>{error}</div>}
        {creating && (
          <form onSubmit={(e) => void handleCreate(e)} style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 6, marginBottom: 12 }}>
            <div className="wb-grid-2">
              <label className="wb-field">
                {t('Schedule Name', '任务名称')}
                <input className="wb-input" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="wb-field">
                {t('Platform', '监测平台')}
                <select className="wb-select" value={platform} onChange={(e) => setPlatform(e.target.value as 'reddit' | 'x')}>
                  <option value="reddit">Reddit (kaix)</option>
                  <option value="x">X (twitterapis)</option>
                </select>
              </label>
            </div>
            <label className="wb-field">
              {t('Keywords (comma separated)', '监测关键词（逗号分隔）')}
              <input className="wb-input" value={keywordsRaw} required placeholder="local llm, inference" onChange={(e) => setKeywordsRaw(e.target.value)} />
            </label>
            <div className="wb-grid-2">
              <label className="wb-field">
                {t(`Interval hours (${minHours}..168)`, `调度周期（${minHours}..168 小时）`)}
                <input type="number" className="wb-input" min={minHours} max={168} value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value))} />
              </label>
              <label className="wb-field">
                {t('Daily item budget (20..20000)', '每日条目预算上限')}
                <input type="number" className="wb-input" min={20} max={20000} value={dailyBudget} onChange={(e) => setDailyBudget(Number(e.target.value))} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="ds-btn" disabled={createMut.isPending}>{t('Create Schedule', '创建并启用')}</button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setCreating(false)}>{t('Cancel', '取消')}</button>
            </div>
          </form>
        )}
        {boundMonitors.length === 0 ? (
          <p className="collection-hint" style={{ margin: 0 }}>
            {t('No continuous scheduled monitor bound to this project yet.', '此项目暂未绑定连续定时监测任务。')}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {boundMonitors.map((m) => (
              <div key={m.id} className="job-row" style={{ alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 12.5 }}>{m.name}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t(`Every ${m.scheduleIntervalHours}h · Daily budget ${m.dailyItemBudget}`, `每 ${m.scheduleIntervalHours} 小时执行 · 日预算 ${m.dailyItemBudget} 条`)}
                    {m.pausedReason && ` · ${t(`Paused (${m.pausedReason})`, `已自动暂停（${m.pausedReason}）`)}`}
                  </div>
                </div>
                <span className={`chip-state ${m.enabled ? 'active' : 'paused'}`}>
                  {m.enabled ? t('Active', '运行中') : t('Paused', '已暂停')}
                </span>
                {canEditProject && (
                  <>
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost"
                      disabled={updateMut.isPending}
                      onClick={() => updateMut.mutate({ id: m.id, payload: { enabled: !m.enabled, revision: m.revision } })}
                    >
                      {m.enabled ? <Pause size={12} /> : <Play size={12} />}
                      <span>{m.enabled ? t('Pause', '暂停') : t('Resume', '启用')}</span>
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn--danger"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate({ id: m.id, revision: m.revision })}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
