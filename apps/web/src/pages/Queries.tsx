import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input } from '../components/ui';
import type {
  CreateKeywordQueryRequest,
  CreateKeywordQueryResponse,
  KeywordQueryView,
} from '../../../../packages/contracts/src/http';

function formatRate(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function resultStatusColor(status: KeywordQueryView['status']) {
  if (status === 'initial_ready' || status === 'completed') return 'success';
  return 'neutral';
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

  const result = keywordQuery.data?.result;

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
                  <Badge variant={resultStatusColor(result.status)}>{result.status}</Badge>
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
