import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Card, Input, Select } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
import { LegacyAnalysisNotice, SourceEmptyLink } from '../features/content/LegacyAnalysisNotice';
import type { MarketTrendRankItem, MarketTrendResponse } from '../../../../packages/contracts/src/http';

type SortKey = 'heat' | 'surge' | 'trend' | 'posts';

function targetPath(canonicalName: string): string {
  return `/target/${canonicalName.replace(/^r\//i, '')}`;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function MarketBoard() {
  const { t, language } = useLanguage();
  const copy = (en: string, cn: string) => language === 'zh-CN' ? cn : en;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('heat');
  const { data, isLoading, error } = useQuery({
    queryKey: ['market.board'],
    queryFn: () => fetchApi<MarketTrendResponse>('/v1/trends/market?limit=50'),
  });

  const rows = useMemo(() => {
    const all = data?.rankings.byHeat ?? [];
    const filtered = all.filter((item) =>
      item.canonicalName.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const scoreFor = (item: MarketTrendRankItem) => {
      switch (sort) {
        case 'surge':
          return item.surgeScore;
        case 'trend':
          return item.trendScore;
        case 'posts':
          return item.newPosts;
        case 'heat':
        default:
          return item.heatIndex;
      }
    };
    return [...filtered].sort((a, b) => scoreFor(b) - scoreFor(a));
  }, [data?.rankings.byHeat, search, sort]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('Market Board')}</h1>
          <p className="page-subtitle">{copy('Sort and filter the returned heat-ranked candidate set.', '对返回的热度候选集合进行排序与筛选。')}</p>
        </div>
      </div>

      <LegacyAnalysisNotice />
      <p role="note" style={{ marginBottom: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>{copy('Candidates are limited to the first 50 targets ranked by heat. Search and other sorts operate only within that set; they are not rankings across the whole monitored market.', '候选范围仅为热度排序返回的前 50 个目标。搜索及其他排序只在该集合内进行，不代表全部监测目标的排行。')}</p>
      <Card style={{ marginBottom: '24px' }}>
        <div className="filter-bar">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search subreddit')}
            style={{ maxWidth: '320px' }}
          />
          <Select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} style={{ maxWidth: '220px' }}>
            <option value="heat">{t('Sort by Heat')}</option>
            <option value="surge">{t('Sort by Surge')}</option>
            <option value="trend">{t('Sort by Trend')}</option>
            <option value="posts">{t('Sort by New Posts')}</option>
          </Select>
          {data && <Badge variant="neutral">{data.coverage.monitoredTargetCount} {t('tracked')}</Badge>}
        </div>
      </Card>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>{t('Loading market board...')}</div>}
      {error && <div style={{ color: '#ff4d4f' }}>{t('Error loading market board.')}</div>}
      {data && rows.length === 0 && <SourceEmptyLink />}

      {data && (
        <Card style={{ padding: '0', overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Subreddit')}</th>
                  <th>{t('New posts')}</th>
                  <th>{t('Sampled')}</th>
                  <th>{t('Heat')}</th>
                  <th>{t('Heat change')}</th>
                  <th>{t('Surge')}</th>
                  <th>{t('Dispersion')}</th>
                  <th>{t('Trend')}</th>
                  <th>{t('Window end')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.targetId}>
                    <td>
                      <Link to={targetPath(item.canonicalName)} style={{ color: 'var(--text-primary)', fontWeight: 560 }}>
                        {item.canonicalName}
                      </Link>
                    </td>
                    <td>{item.newPosts.toLocaleString()}</td>
                    <td>{item.sampledPostCount.toLocaleString()}</td>
                    <td>{item.heatIndex.toFixed(0)}</td>
                    <td>{formatSignedPct(item.heatChangePct)}</td>
                    <td>{item.surgeScore.toFixed(2)}</td>
                    <td>{item.dispersionScore.toFixed(2)}</td>
                    <td>{item.trendScore.toFixed(2)}</td>
                    <td>{new Date(item.windowEnd).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
