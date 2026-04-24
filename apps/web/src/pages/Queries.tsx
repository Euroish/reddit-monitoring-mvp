import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input } from '../components/ui';
import type {
  CreateKeywordQueryRequest,
  CreateKeywordQueryResponse,
  GetKeywordQueryResponse,
  KeywordQueryView,
} from '../../../../packages/contracts/src/http';

function formatRate(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function resultStatusColor(status: KeywordQueryView['status']) {
  if (status === 'initial_ready' || status === 'completed') return 'success';
  return 'neutral';
}

function statusLabel(status: KeywordQueryView['status']) {
  switch (status) {
    case 'initial_ready':
      return 'Initial Ready';
    case 'live_refreshing':
      return 'Live Refreshing';
    case 'completed':
      return 'Completed';
    case 'degraded':
      return 'Degraded';
    case 'queued':
      return 'Queued';
    default:
      return status;
  }
}

function toRedditUrl(permalink: string) {
  return permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
}

export function Queries() {
  const [query, setQuery] = useState('');
  const [subreddit, setSubreddit] = useState('');
  const [limit, setLimit] = useState(10);

  const keywordQuery = useMutation({
    mutationFn: (payload: CreateKeywordQueryRequest) =>
      fetchApi<CreateKeywordQueryResponse>('/v1/keyword-queries', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });

  const createdResult = keywordQuery.data?.result;
  const queryId = createdResult?.queryId;
  const resultQuery = useQuery({
    queryKey: ['keyword-query', queryId],
    queryFn: () => fetchApi<GetKeywordQueryResponse>(`/v1/keyword-queries/${queryId}`),
    enabled: !!queryId,
    refetchInterval: (query) => {
      const status = query.state.data?.result.status;
      if (!status) return 3000;
      return status === 'completed' || status === 'degraded' ? false : 3000;
    },
  });

  const result = resultQuery.data?.result ?? createdResult;
  const isPolling =
    resultQuery.isFetching &&
    !!result &&
    result.status !== 'completed' &&
    result.status !== 'degraded';

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLimit = Math.min(30, Math.max(1, Number.isFinite(limit) ? limit : 10));

    keywordQuery.mutate({
      query,
      subreddit: subreddit.trim() || undefined,
      limit: normalizedLimit,
    });
  };

  return (
    <div>
      <div className="page-header">
        <h1>Queries</h1>
        <p className="page-subtitle">Keyword pulse and supporting posts</p>
      </div>

      <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'start' }}>
        <Card>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label htmlFor="keyword-query" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Keyword
              </label>
              <Input
                id="keyword-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="LLM agent"
                required
                minLength={2}
                maxLength={160}
              />
            </div>

            <div>
              <label htmlFor="keyword-subreddit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Subreddit
              </label>
              <Input
                id="keyword-subreddit"
                value={subreddit}
                onChange={(event) => setSubreddit(event.target.value)}
                placeholder="Optional, e.g. datascience"
              />
            </div>

            <div>
              <label htmlFor="keyword-limit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Sample limit
              </label>
              <Input
                id="keyword-limit"
                type="number"
                min={1}
                max={30}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                required
              />
            </div>

            {keywordQuery.error && (
              <div style={{ color: '#ff4d4f', fontSize: '13px' }}>
                {keywordQuery.error instanceof Error ? keywordQuery.error.message : 'Query failed'}
              </div>
            )}

            {resultQuery.error && (
              <div style={{ color: '#ff4d4f', fontSize: '13px' }}>
                {resultQuery.error instanceof Error ? resultQuery.error.message : 'Query refresh failed'}
              </div>
            )}

            <Button variant="primary" type="submit" disabled={keywordQuery.isPending}>
              {keywordQuery.isPending ? 'Running...' : 'Run query'}
            </Button>
          </form>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {!result && !keywordQuery.isPending && (
            <Card>
              <div className="card-empty">
                Run a keyword query to inspect coverage, quality, and matching posts.
              </div>
            </Card>
          )}

          {result && (
            <>
              <Card>
                <div className="page-header" style={{ marginBottom: '24px' }}>
                  <div>
                    <h2 className="break-text">{result.queryText}</h2>
                    <p className="page-subtitle">
                      {result.canonicalSubreddit ?? 'Global'} · {result.sourceType.primary}
                    </p>
                  </div>
                  <Badge variant={resultStatusColor(result.status)}>{statusLabel(result.status)}</Badge>
                </div>

                <div
                  style={{
                    marginBottom: '20px',
                    padding: '12px 14px',
                    border: '1px solid var(--border-standard)',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                  }}
                >
                  {isPolling
                    ? 'Refreshing live query evidence every 3 seconds.'
                    : result.status === 'completed'
                      ? 'Live refresh completed for this query.'
                      : result.status === 'degraded'
                        ? `Query degraded${result.degradedReason ? `: ${result.degradedReason}` : '.'}`
                        : 'Initial indexed result is ready.'}
                  <div style={{ marginTop: '6px', color: 'var(--text-tertiary)' }}>
                    Last updated {new Date(result.updatedAt).toLocaleString()}
                  </div>
                </div>

                <div className="metric-grid">
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '6px' }}>Support</div>
                    <div className="kpi-value">{result.supportCount}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '6px' }}>Mention rate</div>
                    <div className="kpi-value">{formatRate(result.mentionRate)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '6px' }}>Quality</div>
                    <div className="kpi-value">{result.dataQuality.level}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '6px' }}>Confidence</div>
                    <div className="kpi-value">{result.confidenceLevel}</div>
                  </div>
                </div>
              </Card>

              <Card>
                <h3 style={{ marginBottom: '16px' }}>Live Pulse</h3>
                <div className="list-stack">
                  {result.pulsePoints5m.length === 0 && (
                    <div style={{ color: 'var(--text-tertiary)' }}>No pulse buckets available yet.</div>
                  )}
                  {result.pulsePoints5m.slice(0, 6).map((bucket) => (
                    <div key={bucket.bucketStart} className="list-row" style={{ gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: '150px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {new Date(bucket.bucketStart).toLocaleTimeString()} - {new Date(bucket.bucketEnd).toLocaleTimeString()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>
                          Mentions {bucket.mentionCount} · Qualified {bucket.qualifiedMentionCount}
                        </div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                          Rate {formatRate(bucket.mentionRate)} · Quality {bucket.dataQuality} · Source {bucket.sourceType}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <h3 style={{ marginBottom: '16px' }}>Matching Posts</h3>
                <div className="list-stack">
                  {result.samplePosts.length === 0 && (
                    <div style={{ color: 'var(--text-tertiary)' }}>No matching posts returned.</div>
                  )}
                  {result.samplePosts.map((post) => (
                    <div key={post.contentId} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                      <div className="list-row" style={{ marginBottom: '6px' }}>
                        <Link
                          to={`/target/${post.canonicalSubreddit.replace('r/', '')}`}
                          style={{ color: 'var(--text-primary)', fontWeight: 510 }}
                          className="break-text"
                        >
                          {post.canonicalSubreddit}
                        </Link>
                        <Badge>{post.sourceType}</Badge>
                      </div>
                      <a
                        href={toRedditUrl(post.permalink)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--text-secondary)', display: 'block' }}
                        className="break-text"
                      >
                        {post.title}
                      </a>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: '6px' }}>
                        Match {post.matchScore.toFixed(2)} · {new Date(post.createdAtSource).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
