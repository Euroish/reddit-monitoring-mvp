import { useI18n } from '../../i18n/translations';
import { SOURCE_GROUPS, type SourceGroupKey } from '../../lib/sourceLabels';

interface FeedChannelNavProps {
  selectedGroup: string;
  groupCounts: Record<string, number>;
  onSelectGroup: (group: string) => void;
}

export function FeedChannelNav({
  selectedGroup,
  groupCounts,
  onSelectGroup,
}: FeedChannelNavProps) {
  const { lang, t } = useI18n();
  const groupKeys = Object.keys(SOURCE_GROUPS) as SourceGroupKey[];

  return (
    <div
      className="sh-channel-nav"
      role="group"
      aria-label={t('Browse by channel', '按频道浏览')}
    >
      <button
        type="button"
        aria-pressed={selectedGroup === ''}
        className={`sh-channel-tab ${selectedGroup === '' ? 'is-active' : ''}`}
        onClick={() => onSelectGroup('')}
      >
        <span>{t('All Picks', '全部精选')}</span>
      </button>

      {groupKeys.map((key) => {
        const active = selectedGroup === key;
        const count = groupCounts[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            className={`sh-channel-tab ${active ? 'is-active' : ''}`}
            onClick={() => onSelectGroup(active ? '' : key)}
            title={
              typeof count === 'number'
                ? t(`${SOURCE_GROUPS[key].en} (${count} configured sources)`, `${SOURCE_GROUPS[key].zh}（${count} 个信源）`)
                : SOURCE_GROUPS[key][lang]
            }
          >
            <span>{SOURCE_GROUPS[key][lang]}</span>
            {typeof count === 'number' && count > 0 && (
              <span className="sh-channel-count tabular-nums">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
