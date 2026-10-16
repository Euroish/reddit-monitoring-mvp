import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import type { ContentAnnotationResponse, ContentAnnotationView } from '../../../../../packages/contracts/src/source-content';

type Draft = { revision: number; note: string; favorite: boolean };
const snapshot = (annotation: ContentAnnotationView | null | undefined): Draft => ({ revision: annotation?.revision ?? 0, note: annotation?.note ?? '', favorite: annotation?.favorite ?? false });

export function ContentAnnotation({ contentId, zh }: { contentId: string; zh: boolean }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const copy = (en: string, cn: string) => zh ? cn : en;
  const key = ['contentAnnotation', user?.id, contentId];
  const current = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchApi<ContentAnnotationResponse>(`/v1/content/${encodeURIComponent(contentId)}/annotation`, { signal }), retry: false, enabled: Boolean(user) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [blocked, setBlocked] = useState(false);
  const stored = snapshot(current.data?.annotation), value = draft ?? stored;
  const dirty = Boolean(draft && (draft.note !== stored.note || draft.favorite !== stored.favorite));
  const conflict = Boolean(draft && draft.revision !== stored.revision);
  useUnsavedChanges(dirty, copy('Your personal note has unsaved changes. Leave this page?', '个人注释尚未保存，确定离开此页吗？'));
  const edit = (change: Partial<Draft>) => setDraft(previous => ({ ...(previous ?? stored), ...change }));
  const save = useMutation({
    mutationFn: (action: 'save' | 'delete') => fetchApi<ContentAnnotationResponse>(`/v1/content/${encodeURIComponent(contentId)}/annotation`, { method: action === 'save' ? 'PUT' : 'DELETE', body: JSON.stringify({ ...(action === 'save' ? { note: value.note, favorite: value.favorite } : {}), expectedRevision: value.revision }) }),
    onSuccess: (response, action) => { client.setQueryData(key, action === 'delete' ? { ...response, annotation: null } : response); setDraft(null); setBlocked(false); void client.invalidateQueries({ queryKey: ['contentAnnotations', user?.id] }); },
    onError: error => { if (error instanceof ApiError && (error.status === 409 || error.code === 'audit_result_unknown')) { setBlocked(true); void current.refetch(); } },
  });
  const reload = async () => { const result = await current.refetch(); if (result.isError) return; setDraft(null); setBlocked(false); save.reset(); };
  return <section aria-labelledby="personal-annotation-title" className="content-annotation">
    <h2 id="personal-annotation-title">{copy('My favorite and note', '我的收藏与注释')}</h2>
    <p className="content-muted">{copy('Visible only to your account. Public content stays shared; this note does not alter it.', '仅当前账户可见，公共内容继续共享，个人注释不会修改源内容。')}</p>
    {current.isLoading && <p role="status">{copy('Loading personal note…', '正在读取个人注释…')}</p>}
    {current.error && <p role="alert" className="content-error">{current.error.message} <Button onClick={() => void current.refetch()}>{copy('Retry note', '重试注释')}</Button></p>}
    {current.data && <form onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate('save'); }}>
      <label className="content-check"><input type="checkbox" disabled={save.isPending} checked={value.favorite} onChange={event => edit({ favorite: event.target.checked })} />{copy('Favorite this content', '收藏这条内容')}</label>
      <label className="content-note-label" htmlFor="personal-content-note">{copy('Personal note', '个人注释')}<textarea id="personal-content-note" aria-label={copy('Personal note', '个人注释')} maxLength={2000} rows={5} disabled={save.isPending} value={value.note} onChange={event => edit({ note: event.target.value })} /></label>
      <p className="content-muted">{value.note.length}/2000 · {copy('Revision', '版本')} {value.revision}{dirty ? ` · ${copy('Unsaved changes', '尚未保存')}` : ''}</p>
      {(conflict || blocked) && <p role="alert" className="content-error">{copy('The saved version changed or the operation outcome is unknown. Your draft is preserved. Reload the current note before editing again.', '已存版本变化或操作结果未知，输入已保留。请重新载入当前注释后再编辑。')}</p>}
      {save.error && <p role="alert" className="content-error">{save.error.message}</p>}
      <div className="content-actions"><Button type="submit" disabled={!dirty || save.isPending || conflict || blocked}>{copy('Save personal note', '保存个人注释')}</Button><Button type="button" onClick={() => void reload()} disabled={save.isPending || current.isFetching}>{copy('Reload personal note', '重新载入个人注释')}</Button><Button type="button" disabled={value.revision === 0 || save.isPending || conflict || blocked} onClick={() => { if (window.confirm(copy('Delete this account’s favorite and note?', '删除当前账户的收藏与注释吗？'))) save.mutate('delete'); }}>{copy('Delete personal note', '删除个人注释')}</Button></div>
      {save.isSuccess && <p role="status">{copy('Personal annotation updated.', '个人收藏与注释已更新。')}</p>}
    </form>}
  </section>;
}
