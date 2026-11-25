import { useRef, useState } from 'react';
import { Check, ChevronDown, FolderKanban, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import type { Project } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function ProjectSwitcher({
  projects,
  selected,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  selected?: Project;
  onSelect: (project: Project) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'mine' | 'shared'>('all');
  const [open, setOpen] = useState(false);

  const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

  const triggerSummary = (project: Project) => {
    const ds = project.data_summary;
    if (project.dataset_mode === 'batch') {
      const batches = project.enabled_batch_count ?? 0;
      if (batches === 0) return t('Awaiting data', '待接入研究数据');
      const items = ds?.item_count ?? 0;
      const platText = ds?.platforms.length ? ` · ${ds.platforms.map((p) => p.toUpperCase()).join('/')}` : '';
      return items > 0
        ? t(`${items} items · ${batches} batches${platText}`, `${items} 条样本 · ${batches} 批次${platText}`)
        : t(`${batches} enabled batches${platText}`, `${batches} 个已启用批次${platText}`);
    }
    const platText = ds?.platforms.length ? ` · ${ds.platforms.map((p) => p.toUpperCase()).join('/')}` : '';
    return t(`${project.source_ids.length} bound sources${platText}`, `${project.source_ids.length} 个绑定来源${platText}`);
  };

  const needle = query.trim().toLocaleLowerCase();
  const highlight = (value: string) => {
    const index = needle ? value.toLocaleLowerCase().indexOf(needle) : -1;
    return index < 0 ? (
      value
    ) : (
      <>
        {value.slice(0, index)}
        <mark>{value.slice(index, index + needle.length)}</mark>
        {value.slice(index + needle.length)}
      </>
    );
  };

  const matching = projects.filter((project) => {
    if (!needle) return true;
    const ds = project.data_summary;
    const searchable = [
      project.name,
      project.description ?? '',
      ...(ds?.source_labels ?? []),
      ...(ds?.platforms ?? []),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return searchable.includes(needle);
  });

  const groups = [
    { id: 'mine', title: t('My research', '我的研究'), items: matching.filter((project) => !project.is_shared) },
    { id: 'shared', title: t('System shared', '系统共享'), items: matching.filter((project) => project.is_shared) },
  ].filter((group) => (filter === 'all' || group.id === filter) && group.items.length > 0);

  function closeSwitcher() {
    setOpen(false);
  }

  return (
    <Dialog
      modal
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery('');
          setFilter('all');
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        ref={trigger}
        type="button"
        className="proj-switch"
        aria-label={selected ? t(`Switch project · ${selected.name}`, `切换项目 · ${selected.name}`) : t('Select research project', '选择研究项目')}
      >
        <span className="ps-icon-box" aria-hidden="true">
          <FolderKanban size={17} strokeWidth={1.8} />
        </span>
        <span className="ps-txt">
          <b>{selected?.name ?? t('Select research project', '选择研究项目')}</b>
          <small>{selected ? triggerSummary(selected) : t('Create or select a project', '新建或选择一个项目')}</small>
        </span>
        <ChevronDown size={15} className="ps-chevron" aria-hidden="true" />
      </DialogTrigger>

      <DialogContent
        className="project-switcher"
        showCloseButton={false}
        initialFocus={search}
        finalFocus={trigger}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') event.stopPropagation();
        }}
      >
        <header className="project-switcher-header">
          <div>
            <DialogTitle className="project-switcher-title">{t('Switch research project', '切换研究项目')}</DialogTitle>
            <small style={{ color: 'var(--muted)' }}>
              {t('View included platforms, targets, and sample sizes across your accessible projects.', '查看各项目包含的数据平台、来源目标与样本规模，快速切换研究上下文。')}
            </small>
          </div>
          <DialogClose type="button" className="icon-square" aria-label={t('Close project switcher', '关闭项目选择器')}>
            <X size={19} />
          </DialogClose>
        </header>

        <label className="wb-field">
          {t('Search by project name, description, source, or platform', '按项目名称、说明、数据来源或平台搜索')}
          <Input ref={search} className="wb-input" type="text" role="searchbox" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>

        <div className="project-switcher-filters" role="group" aria-label={t('Filter projects', '筛选项目')}>
          {(['all', 'mine', 'shared'] as const).map((item) => (
            <button key={item} type="button" className="ds-btn ds-btn--ghost" aria-pressed={filter === item} onClick={() => setFilter(item)}>
              {item === 'all' ? t('All', '全部') : item === 'mine' ? t('My research', '我的研究') : t('System shared', '系统共享')}
            </button>
          ))}
        </div>

        <div className="project-switcher-results">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.title}>
              <h3>
                {group.title} · {group.items.length}
              </h3>
              <div className="project-switcher-cards">
                {group.items.map((project) => {
                  const ds = project.data_summary;
                  const sourceLabels = ds?.source_labels ?? [];
                  const platforms = ds?.platforms ?? [];
                  const enabledCount = project.enabled_batch_count ?? 0;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className="project-switcher-card"
                      aria-current={project.id === selected?.id ? 'true' : undefined}
                      onClick={() => {
                        closeSwitcher();
                        onSelect(project);
                      }}
                    >
                      <span className={'ps-avatar' + (project.is_shared ? ' project-switcher-shared' : '')} aria-hidden="true">
                        {initials(project.name)}
                      </span>
                      <span className="project-switcher-copy">
                        <span className="project-switcher-card-top">
                          <strong>{highlight(project.name)}</strong>
                          <span className="project-switcher-badges">
                            <span className="tag" style={{ fontSize: 10 }}>
                              {project.dataset_mode === 'batch' ? t('Batch', '批次型') : t('Source', '来源型')}
                            </span>
                            {project.can_edit === false && (
                              <span className="tag tag--line" style={{ fontSize: 10 }}>
                                {t('Read-only', '只读')}
                              </span>
                            )}
                          </span>
                        </span>

                        {project.description && <span className="project-switcher-desc">{highlight(project.description)}</span>}

                        <div className="project-switcher-data">
                          <div className="project-switcher-metrics">
                            {project.dataset_mode === 'batch' ? (
                              <>
                                <b>{t(`${ds?.item_count ?? 0} samples`, `${ds?.item_count ?? 0} 条样本`)}</b>
                                <span>·</span>
                                <span>
                                  {t(`${enabledCount} active batch(es)`, `${enabledCount} 个启用批次`)}
                                  {(ds?.shared_batch_count ?? 0) > 0 || (ds?.private_batch_count ?? 0) > 0
                                    ? `（${t('Private', '私有')} ${ds?.private_batch_count ?? 0} / ${t('Shared', '共享')} ${ds?.shared_batch_count ?? 0}）`
                                    : ''}
                                </span>
                              </>
                            ) : (
                              <b>{t(`${project.source_ids.length} bound sources`, `绑定 ${project.source_ids.length} 个来源`)}</b>
                            )}
                          </div>

                          {(platforms.length > 0 || sourceLabels.length > 0) ? (
                            <div className="project-switcher-sources">
                              {platforms.map((plat) => (
                                <span key={plat} className="tag tag--mint" style={{ fontSize: 10 }}>
                                  {plat.toUpperCase()}
                                </span>
                              ))}
                              {sourceLabels.slice(0, 4).map((label) => (
                                <span key={label} className="tag tag--lilac" style={{ fontSize: 10 }}>
                                  {highlight(label)}
                                </span>
                              ))}
                              {sourceLabels.length > 4 && (
                                <span className="tag" style={{ fontSize: 10 }}>
                                  +{sourceLabels.length - 4}
                                </span>
                              )}
                            </div>
                          ) : (
                            <small>{t('No data sources or batches included yet', '暂未包含采集数据批次')}</small>
                          )}
                        </div>

                        <small className="project-switcher-time">
                          {ds?.latest_batch_at && (
                            <>
                              {t('Latest batch', '最近批次')}{' '}
                              <time dateTime={ds.latest_batch_at}>{ds.latest_batch_at.slice(0, 10)}</time> ·{' '}
                            </>
                          )}
                          {project.updated_at && (
                            <>
                              {t('Updated', '更新于')} <time dateTime={project.updated_at}>{project.updated_at.slice(0, 10)}</time>
                            </>
                          )}
                        </small>
                      </span>
                      {project.id === selected?.id && <Check size={16} aria-label={t('Current project', '当前项目')} />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <div className="project-switcher-empty" role="status">
              <p>{projects.length === 0 ? t('No projects yet.', '还没有研究项目。') : t('No matching projects.', '没有符合条件的项目。')}</p>
              {projects.length > 0 && (
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                    search.current?.focus();
                  }}
                >
                  {t('Clear filters', '清除筛选')}
                </button>
              )}
            </div>
          )}
        </div>

        <footer>
          <Button
            type="button"
            className="ds-btn"
            onClick={() => {
              closeSwitcher();
              onCreate();
            }}
          >
            {t('Create research project', '新建研究项目')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
