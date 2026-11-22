import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatApiError, useImportSourcesMutation } from '../api/hooks';
import type { SourceInput } from '../contracts/api';
import { useI18n } from '../i18n/translations';

const maxFileBytes = 512 * 1024;

export function SourceImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [format, setFormat] = useState<'opml' | 'json'>('opml');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const mutation = useImportSourcesMutation();
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      if (file.size > maxFileBytes) throw new Error(t('Select a file up to 512 KiB.', '文件不能超过 512 KiB。'));
      const text = await file.text();
      setInput(text);
      setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'opml');
      mutation.reset();
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      if (new TextEncoder().encode(input).length > maxFileBytes) throw new Error(t('Import content cannot exceed 512 KiB.', '导入内容不能超过 512 KiB。'));
      if (format === 'opml') {
        const document = new DOMParser().parseFromString(input, 'application/xml');
        if (document.documentElement.localName !== 'opml' || document.querySelector('parsererror'))
          throw new Error(t('Enter valid OPML XML.', '请输入有效的 OPML XML。'));
        const fields = new FormData(event.currentTarget);
        await mutation.mutateAsync({
          format, opml: input,
          defaults: { schedule: { enabled: fields.has('scheduled') } },
        });
      } else {
        const sources: unknown = JSON.parse(input);
        if (!Array.isArray(sources) || sources.length < 1 || sources.length > 200)
          throw new Error(t('Enter an array of 1–200 source configurations.', '请输入包含 1–200 条来源配置的数组。'));
        await mutation.mutateAsync({ format, sources: sources as SourceInput[] });
      }
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  return (
    <dialog ref={dialog} className="sr-modal source-editor collection-dialog" aria-labelledby="source-import-title"
      onCancel={event => { event.preventDefault(); if (!mutation.isPending) onClose(); }}>
      <h3 id="source-import-title">{t('Import sources', '批量导入来源')}</h3>
      <p className="collection-hint">{t('Use OPML for subscriptions or JSON for complete source configurations. The result lists duplicates and failed entries.', '订阅列表选 OPML，完整来源配置选 JSON。导入结果会列出跳过的重复数和失败条目。')}</p>
      <form onSubmit={submit} className="collection-form">
        <fieldset className="source-editor-fields" disabled={mutation.isPending}>
          <label className="wb-field">{t('Format', '格式')}
            <select className="wb-select" value={format} onChange={event => { setFormat(event.target.value as typeof format); mutation.reset(); }}>
              <option value="opml">OPML</option><option value="json">JSON</option>
            </select>
          </label>
          <label className="wb-field">{t('Choose file', '选择文件')}<input type="file" accept=".opml,.xml,.json" onChange={event => { void loadFile(event.target.files?.[0]); }} /></label>
          <label className="wb-field">{format === 'opml' ? t('OPML feed list', 'OPML Feed 列表') : t('JSON array of source configurations', 'JSON 来源配置数组')}
            <textarea className="wb-input" rows={8} value={input} required onChange={event => { setInput(event.target.value); mutation.reset(); }} />
          </label>
          {format === 'opml' && <label><input type="checkbox" name="scheduled" /> {t('Enable automatic scheduling for new feeds', '为新导入 Feed 启用自动调度')}</label>}
        </fieldset>
        {error && <div role="alert" className="wb-alert wb-alert--error">{error}</div>}
        {mutation.data && <section className="wb-alert" role="status">
          {t('Created', '已创建')} {mutation.data.created} · {t('Duplicates skipped', '重复跳过')} {mutation.data.skipped} · {t('Errors', '错误')} {mutation.data.errors.length}
          {mutation.data.errors.length > 0 && <ul>{mutation.data.errors.map(item => <li key={item.index}>#{item.index + 1} {item.label} · {item.error}</li>)}</ul>}
        </section>}
        <footer className="source-editor-header">
          <button type="button" className="ds-btn ds-btn--ghost" onClick={onClose} disabled={mutation.isPending}>{t('Close', '关闭')}</button>
          <button type="submit" className="ds-btn" disabled={mutation.isPending}>{mutation.isPending ? t('Importing…', '正在导入…') : t('Import sources', '导入来源')}</button>
        </footer>
      </form>
    </dialog>
  );
}
