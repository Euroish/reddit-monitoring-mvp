import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Input } from '../../components/ui';
import { canonicalContentQuery, contentQueryPath } from './queryState';
import type { ContentAnnotationListResponse, ContentSavedQueryListResponse, ContentSavedQueryView, SaveContentQueryResponse } from '../../../../../packages/contracts/src/source-content';

function SavedQueryRow({ view, zh, onChanged, onReload }: { view: ContentSavedQueryView; zh: boolean; onChanged: () => void; onReload: () => Promise<boolean> }) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  const [draft, setDraft] = useState<{ name: string; revision: number } | null>(null), [blocked, setBlocked] = useState(false);
  const value = draft ?? view, conflict = Boolean(draft && draft.revision !== view.revision);
  const mutation = useMutation({ mutationFn: (action: 'rename' | 'delete') => fetchApi<SaveContentQueryResponse>(`/v1/content-saved-queries/${encodeURIComponent(view.id)}`, { method: action === 'rename' ? 'PATCH' : 'DELETE', body: JSON.stringify({ ...(action === 'rename' ? { name: value.name.trim(), query: canonicalContentQuery(view.query) } : {}), expectedRevision: value.revision }) }),
    onSuccess: () => { setDraft(null); setBlocked(false); onChanged(); },
    onError: error => { if (error instanceof ApiError && (error.status === 409 || error.code === 'audit_result_unknown')) { setBlocked(true); onChanged(); } },
  });
  return <li className="content-saved-query-row">
    <Link to={contentQueryPath(view.query)}>{view.name}</Link><p className="content-muted">{copy('Updated', '更新于')} {new Date(view.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {copy('Revision', '版本')} {view.revision}</p>
    <form className="content-fields" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate('rename'); }}>
      <label htmlFor={`saved-name-${view.id}`}>{copy('Rename saved query', '重命名保存查询')}<Input id={`saved-name-${view.id}`} value={value.name} maxLength={100} required disabled={mutation.isPending} onChange={event => setDraft(old => ({ revision: old?.revision ?? view.revision, name: event.target.value }))} /></label>
      <Button type="submit" disabled={!value.name.trim() || !draft || draft.name.trim() === view.name || conflict || blocked || mutation.isPending}>{copy('Rename query', '重命名查询')}</Button>
      <Button type="button" onClick={() => { void onReload().then(ok => { if (ok) { setDraft(null); setBlocked(false); mutation.reset(); } }); }} disabled={mutation.isPending}>{copy('Reload saved query', '重新载入保存查询')}</Button>
      <Button type="button" disabled={conflict || blocked || mutation.isPending} onClick={() => { if (window.confirm(copy('Delete this saved query?', '删除此保存查询吗？'))) mutation.mutate('delete'); }}>{copy('Delete query', '删除查询')}</Button>
    </form>
    {(conflict || blocked) && <p role="alert" className="content-error">{copy('The saved query changed or its operation outcome is unknown. Your name draft is preserved; reload before retrying.', '保存查询版本变化或操作结果未知，名称草稿已保留；请重新载入后再重试。')}</p>}
    {mutation.error && <p role="alert" className="content-error">{mutation.error.message}</p>}
  </li>;
}

export function PersonalSavedContent({ zh }: { zh: boolean }) {
  const { user } = useAuth(), client = useQueryClient();
  const copy = (en: string, cn: string) => zh ? cn : en;
  const [queryCursor, setQueryCursor] = useState(''), [queryPrevious, setQueryPrevious] = useState<string[]>([]);
  const [noteCursor, setNoteCursor] = useState(''), [notePrevious, setNotePrevious] = useState<string[]>([]), [favoritesOnly, setFavoritesOnly] = useState(true);
  const queries = useQuery({ queryKey: ['contentSavedQueries', user?.id, queryCursor], queryFn: ({ signal }) => fetchApi<ContentSavedQueryListResponse>(`/v1/content-saved-queries?limit=20${queryCursor ? `&cursor=${encodeURIComponent(queryCursor)}` : ''}`, { signal }), retry: false, enabled: Boolean(user) });
  const notes = useQuery({ queryKey: ['contentAnnotations', user?.id, favoritesOnly, noteCursor], queryFn: ({ signal }) => fetchApi<ContentAnnotationListResponse>(`/v1/content-annotations?limit=20${favoritesOnly ? '&favorite=true' : ''}${noteCursor ? `&cursor=${encodeURIComponent(noteCursor)}` : ''}`, { signal }), retry: false, enabled: Boolean(user) });
  const changed = () => { void client.invalidateQueries({ queryKey: ['contentSavedQueries', user?.id] }); };
  return <div className="source-content-page content-personal-saved">
    <section aria-labelledby="personal-queries-title"><h2 id="personal-queries-title">{copy('My content queries', '我的内容查询')}</h2>
      <p className="content-muted">{copy('Personal queries reopen public saved content with their exact filters. Page cursors and export limits are excluded.', '个人查询按原筛选恢复公共已存内容，不包含分页游标或导出上限。')}</p>
      {queries.isLoading && <p role="status">{copy('Loading my queries…', '正在读取我的查询…')}</p>}
      {queries.error && <p role="alert" className="content-error">{queries.error.message} <Button onClick={() => void queries.refetch()}>{copy('Retry queries', '重试查询')}</Button></p>}
      {queries.data?.queries.length === 0 && <p>{copy('No personal content queries yet. ', '暂无个人内容查询。')}<Link to="/content">{copy('Search and save content', '查询并保存内容')}</Link></p>}
      <ul className="content-saved-query-list">{queries.data?.queries.map(view => <SavedQueryRow key={view.id} view={view} zh={zh} onChanged={changed} onReload={async () => !(await queries.refetch()).isError} />)}</ul>
      {(queryPrevious.length > 0 || queries.data?.nextCursor) && <div className="content-pager"><Button disabled={!queryPrevious.length || queries.isFetching} onClick={() => { setQueryCursor(queryPrevious.at(-1) ?? ''); setQueryPrevious(queryPrevious.slice(0, -1)); }}>{copy('Previous queries', '上一页查询')}</Button><Button disabled={!queries.data?.nextCursor || queries.isFetching} onClick={() => { setQueryPrevious([...queryPrevious, queryCursor]); setQueryCursor(queries.data?.nextCursor ?? ''); }}>{copy('Next queries', '下一页查询')}</Button></div>}
    </section>
    <section aria-labelledby="personal-favorites-title"><h2 id="personal-favorites-title">{copy('My favorites and notes', '我的收藏与注释')}</h2>
      <label className="content-check"><input type="checkbox" checked={favoritesOnly} onChange={event => { setFavoritesOnly(event.target.checked); setNoteCursor(''); setNotePrevious([]); }} />{copy('Favorites only', '仅显示收藏')}</label>
      {notes.isLoading && <p role="status">{copy('Loading my annotations…', '正在读取我的注释…')}</p>}
      {notes.error && <p role="alert" className="content-error">{notes.error.message} <Button onClick={() => void notes.refetch()}>{copy('Retry favorites', '重试收藏')}</Button></p>}
      {notes.data?.items.length === 0 && <p>{copy('No matching favorites or notes for this account.', '当前账户没有符合条件的收藏或注释。')}</p>}
      <ul className="content-saved-query-list">{notes.data?.items.map(({ annotation, content }) => <li key={content.id}><Link to={`/content/${encodeURIComponent(content.id)}?back=${encodeURIComponent('/saved')}`}>{content.title || content.text?.slice(0, 100) || content.externalId}</Link><p className="content-muted">{content.platform} · {content.kind} · {annotation.favorite ? copy('Favorite', '已收藏') : copy('Note', '注释')} · {copy('Revision', '版本')} {annotation.revision}</p>{annotation.note && <p className="content-text">{annotation.note}</p>}</li>)}</ul>
      {(notePrevious.length > 0 || notes.data?.nextCursor) && <div className="content-pager"><Button disabled={!notePrevious.length || notes.isFetching} onClick={() => { setNoteCursor(notePrevious.at(-1) ?? ''); setNotePrevious(notePrevious.slice(0, -1)); }}>{copy('Previous favorites', '上一页收藏')}</Button><Button disabled={!notes.data?.nextCursor || notes.isFetching} onClick={() => { setNotePrevious([...notePrevious, noteCursor]); setNoteCursor(notes.data?.nextCursor ?? ''); }}>{copy('Next favorites', '下一页收藏')}</Button></div>}
    </section>
  </div>;
}
