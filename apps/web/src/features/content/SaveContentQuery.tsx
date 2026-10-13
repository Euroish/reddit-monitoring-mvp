import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Input } from '../../components/ui';
import { canonicalContentQuery } from './queryState';
import type { SaveContentQueryResponse, SavedContentQuery } from '../../../../../packages/contracts/src/source-content';

export function SaveContentQuery({ query, zh }: { query: SavedContentQuery; zh: boolean }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const copy = (en: string, cn: string) => zh ? cn : en;
  const save = useMutation({
    mutationFn: () => fetchApi<SaveContentQueryResponse>('/v1/content-saved-queries', { method: 'POST', body: JSON.stringify({ name: name.trim(), query: canonicalContentQuery(query), expectedRevision: 0 }) }),
    onSuccess: () => { setName(''); void client.invalidateQueries({ queryKey: ['contentSavedQueries', user?.id] }); },
    onError: error => { if (error instanceof ApiError && error.code === 'audit_result_unknown') setUnknownOutcome(true); },
  });
  return <details className="content-save-query"><summary>{copy('Save applied query for my account', '将已应用查询保存到我的账户')}</summary>
    <p className="content-muted">{copy('Saves the applied filters, including their order and publication window. Page position and export limits are excluded.', '保存已应用的筛选、排序和发布时间范围，不保存分页位置或导出上限。')}</p>
    <form className="content-fields" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}>
      <label htmlFor="saved-content-query-name">{copy('Query name', '查询名称')}<Input id="saved-content-query-name" required maxLength={100} disabled={save.isPending} value={name} onChange={event => { setName(event.target.value); save.reset(); }} /></label>
      <Button type="submit" disabled={!name.trim() || save.isPending || unknownOutcome}>{copy('Save query', '保存查询')}</Button>
    </form>
    {save.error && <p role="alert" className="content-error">{save.error.message}</p>}
    {unknownOutcome && <p role="alert">{copy('The query may already be saved. Check saved queries before submitting another creation. ', '查询可能已经保存，请先检查保存列表再重新创建。')}<Link to="/saved">{copy('Inspect saved queries', '检查保存查询')}</Link></p>}
    {save.isSuccess && <p role="status">{copy('Query saved. ', '查询已保存。')}<Link to="/saved">{copy('Manage saved queries', '管理保存查询')}</Link></p>}
  </details>;
}
