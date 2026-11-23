import { useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import type { Project } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function ProjectSwitcher({ projects, selected, onSelect, onCreate }: {
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
  const summary = (project: Project) => project.dataset_mode === 'batch'
    ? (project.enabled_batch_count ?? 0) > 0
      ? t(`${project.enabled_batch_count} enabled batches`, `${project.enabled_batch_count} 个已启用批次`)
      : t('Awaiting data', '待接入研究数据')
    : t(`${project.source_ids.length} bound sources`, `${project.source_ids.length} 个绑定来源`);
  const needle = query.trim().toLocaleLowerCase();
  const highlight = (value: string) => {
    const index = needle ? value.toLocaleLowerCase().indexOf(needle) : -1;
    return index < 0 ? value : <>{value.slice(0, index)}<mark>{value.slice(index, index + needle.length)}</mark>{value.slice(index + needle.length)}</>;
  };
  const matching = projects.filter(project =>
    `${project.name} ${project.description ?? ''}`.toLocaleLowerCase().includes(needle));
  const groups = [
    { id: 'mine', title: t('My research', '我的研究'), items: matching.filter(project => !project.is_shared) },
    { id: 'shared', title: t('System shared', '系统共享'), items: matching.filter(project => project.is_shared) },
  ].filter(group => (filter === 'all' || group.id === filter) && group.items.length > 0);

  function closeSwitcher() {
    setOpen(false);
  }

  return <Dialog modal open={open} onOpenChange={next => {
    if (next) { setQuery(''); setFilter('all'); }
    setOpen(next);
  }}>
    <DialogTrigger ref={trigger} type="button" className="proj-switch"
      aria-label={selected ? t(`Switch project · ${selected.name}`, `切换项目 · ${selected.name}`) : t('Select research project', '选择研究项目')}>
      <span className="ps-avatar" aria-hidden="true">{initials(selected?.name ?? 'SL')}</span>
      <span className="ps-txt">
        <b>{selected?.name ?? t('Select research project', '选择研究项目')}</b>
        <small>{selected ? summary(selected) : t('Create or select a project', '新建或选择一个项目')}</small>
      </span>
      <ChevronDown size={14} aria-hidden="true" />
    </DialogTrigger>
    <DialogContent className="project-switcher" showCloseButton={false} initialFocus={search} finalFocus={trigger}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') event.stopPropagation();
      }}>
      <header className="project-switcher-header">
        <DialogTitle className="project-switcher-title">{t('Switch research project', '切换研究项目')}</DialogTitle>
        <DialogClose type="button" className="icon-square" aria-label={t('Close project switcher', '关闭项目选择器')}><X size={19} /></DialogClose>
      </header>
      <label className="wb-field">{t('Search by project name or description', '搜索项目名称或说明')}
        <Input ref={search} className="wb-input" type="text" role="searchbox" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="project-switcher-filters" role="group" aria-label={t('Filter projects', '筛选项目')}>
        {(['all', 'mine', 'shared'] as const).map(item => <button key={item} type="button" className="ds-btn ds-btn--ghost"
          aria-pressed={filter === item} onClick={() => setFilter(item)}>
          {item === 'all' ? t('All', '全部') : item === 'mine' ? t('My research', '我的研究') : t('System shared', '系统共享')}
        </button>)}
      </div>
      <div className="project-switcher-results">
        {groups.map(group => <section key={group.id} aria-label={group.title}>
          <h3>{group.title} · {group.items.length}</h3>
          <div className="project-switcher-cards">
            {group.items.map(project => <button key={project.id} type="button" className="project-switcher-card"
              aria-current={project.id === selected?.id ? 'true' : undefined}
              onClick={() => { closeSwitcher(); onSelect(project); }}>
              <span className={'ps-avatar' + (project.is_shared ? ' project-switcher-shared' : '')} aria-hidden="true">{initials(project.name)}</span>
              <span className="project-switcher-copy">
                <strong>{highlight(project.name)}</strong>
                {project.description && <span>{highlight(project.description)}</span>}
                <small>{summary(project)}{project.can_edit === false && ' · ' + t('Read-only', '只读')}</small>
                {project.updated_at && <small>{t('Updated', '更新于')} <time dateTime={project.updated_at}>{project.updated_at.slice(0, 10)}</time></small>}
              </span>
              {project.id === selected?.id && <Check size={16} aria-label={t('Current project', '当前项目')} />}
            </button>)}
          </div>
        </section>)}
        {groups.length === 0 && <div className="project-switcher-empty" role="status">
          <p>{projects.length === 0 ? t('No projects yet.', '还没有研究项目。') : t('No matching projects.', '没有符合条件的项目。')}</p>
          {projects.length > 0 && <button type="button" className="ds-btn ds-btn--ghost"
            onClick={() => { setQuery(''); setFilter('all'); search.current?.focus(); }}>{t('Clear filters', '清除筛选')}</button>}
        </div>}
      </div>
      <footer><Button type="button" className="ds-btn" onClick={() => { closeSwitcher(); onCreate(); }}>
        {t('Create research project', '新建研究项目')}
      </Button></footer>
    </DialogContent>
  </Dialog>;
}
