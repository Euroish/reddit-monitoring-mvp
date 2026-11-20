import { sourceGroups, tierLabels, languages } from "../sourceLabels";
import { useState, useRef, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import type { Static } from "@sinclair/typebox";
import type {
  CollectionSource,
  SourceImportInput,
  SourceInput,
  SourcePreview,
} from "../../../../packages/contracts/src/source-content";
import { webBoards } from "../../../../packages/contracts/src/web-boards";
import { Field, Heading, Empty } from "../ui";
import { api, type Run } from "../api";
import { providerBudgetQuery, quotaFields } from "../budgets";

const budgetFields = {
  daily_requests: ["dailyRequests", "每日请求"],
  monthly_requests: ["monthlyRequests", "每月请求"],
  daily_resources: ["dailyResources", "每日记录额度"],
  monthly_resources: ["monthlyResources", "每月记录额度"],
  minimum_interval_ms: ["minimumIntervalMs", "最短请求间隔（毫秒）"],
} as const;
type ImportError = string | { index?: number; label?: string; url?: string; error?: string; message?: string };
type ImportResult = { created: number | unknown[]; skipped: number | unknown[]; errors: ImportError[] | number };

const parseTags = (raw: FormDataEntryValue | null) =>
  Array.from(new Set(String(raw ?? "").split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
const groupLabel = (group: string | null | undefined) =>
  group ? (sourceGroups[group as keyof typeof sourceGroups] ?? group) : null;
const localeLabel = (locale: string | null | undefined) =>
  locale ? (languages[locale as keyof typeof languages] ?? locale) : null;
const hitRate = (health: CollectionSource["health"] | undefined) =>
  typeof health?.totalRuns === "number" && health.totalRuns > 0 && typeof health.notModifiedRuns === "number"
    ? { pct: Math.round((health.notModifiedRuns / health.totalRuns) * 100), hits: health.notModifiedRuns, total: health.totalRuns }
    : null;
const countOf = (value: number | unknown[]) => (Array.isArray(value) ? value.length : value);
const formatImportError = (item: ImportError) =>
  typeof item === "string"
    ? item
    : [item.index !== undefined ? `#${item.index + 1}` : "", item.label ?? item.url ?? "", item.error ?? item.message ?? JSON.stringify(item)].filter(Boolean).join(" · ");

export default function Sources({ run, canEdit }: { run: Run; canEdit: boolean }) {
  const collectionRequest = useRef<{ body: string; key: string } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [preview, setPreview] = useState<Static<typeof SourcePreview> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [creating, setCreating] = useState(false),
    [importing, setImporting] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [provider, setProvider] = useState("kaix"),
    [targetType, setTargetType] = useState("search"),
    [listFormat, setListFormat] = useState(""),
    [filterGroup, setFilterGroup] = useState(""),
    [abnormalOnly, setAbnormalOnly] = useState(false),
    [importText, setImportText] = useState(""),
    [importFileKind, setImportFileKind] = useState<"auto" | "json" | "opml">("auto"),
    [importGroup, setImportGroup] = useState(""),
    [importTier, setImportTier] = useState<"T1" | "T1_5" | "T2">("T2"),
    [importLocale, setImportLocale] = useState(""),
    [importSchedule, setImportSchedule] = useState(false),
    [importBusy, setImportBusy] = useState(false),
    [importResult, setImportResult] = useState<ImportResult | null>(null);

  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  const allSources = sources.data?.sources ?? [];
  const filteredSources = allSources.filter((source) => {
    if (filterGroup && source.sourceGroup !== filterGroup) return false;
    if (abnormalOnly) {
      const h = source.health;
      if (!h?.lastTruncated && (h?.consecutiveFailures ?? 0) === 0 && !source.automaticCollectionBlocked) return false;
    }
    return true;
  });
  const selected = allSources.find((source) => source.id === selectedId);
  const budgets = useQuery({
    ...providerBudgetQuery,
    enabled: canEdit && selected?.deliveryMode === "pull",
  });
  const budget = budgets.data?.budgets.find(({ provider }) => provider === selected?.primaryProvider);
  const jobs = useQuery({
    queryKey: ["jobs", selected?.id],
    enabled: !!selected,
    refetchInterval: selected ? 5000 : false,
    queryFn: () =>
      api<{
        jobs: {
          id: string;
          status: string;
          records_processed: number;
          error: string | null;
          provider_state: { phase?: string };
        }[];
      }>(`/sources/${selected!.id}/jobs`),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("target") ?? "");
    const listField = (name: string) => String(form.get(name) ?? "").trim();
    const target = targetType === "account" ? { type: "account", account: value }
      : targetType === "community" ? { type: "community", community: value }
      : targetType === "feed" ? {
          type: "feed",
          url: value,
          ...(provider === "feed" && (listFormat === "web_list" || listFormat === "json_list") ? {
            list: {
              format: listFormat,
              items: listField("listItems"),
              link: listField("listLink"),
              title: listField("listTitle"),
              ...(listField("listSummary") ? { summary: listField("listSummary") } : {}),
              ...(listField("listPublishedAt") ? { publishedAt: listField("listPublishedAt") } : {}),
              ...(listField("listAuthor") ? { author: listField("listAuthor") } : {}),
            },
          } : {}),
        }
      : { type: "search", query: value };
    const sourceGroupVal = String(form.get("sourceGroup") ?? "").trim();
    const localeVal = String(form.get("locale") ?? "").trim();
    const tags = parseTags(form.get("tags"));
    const body = JSON.stringify({
      label: form.get("label"),
      platform: provider === "bluesky_appview" ? "bluesky" : provider === "twitterapis" ? "x" :
        ["feed", "newsnow"].includes(provider) ? "web" : "reddit",
      primaryProvider: provider,
      fallbackProvider: form.get("fallbackProvider") || undefined,
      deliveryMode: provider === "external_ingest" ? "push" : "pull",
      contentKind: ["feed", "newsnow"].includes(provider) ? "article" : "post",
      tier: form.get("tier"),
      ownerEntityId: form.get("ownerEntityId") || null,
      sourceGroup: sourceGroupVal || null,
      locale: localeVal || null,
      ...(tags.length ? { tags } : {}),
      target,
      schedule: provider === "external_ingest" ? undefined : {
        enabled: form.has("schedule"),
        cadenceSeconds: Number(form.get("cadenceSeconds") || 3600),
        pageSize: Number(form.get("pageSize") || 30),
        ...(provider === "newsnow" ? { maxPages: 1 } : {}),
      },
    });
    const previewOnly = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "preview";
    if (previewOnly) setPreviewing(true);
    void run(async () => {
      if (previewOnly) {
        setPreview(await api<Static<typeof SourcePreview>>("/sources/preview", { method: "POST", body }));
        return;
      }
      await api("/sources", { method: "POST", body });
      setCreating(false);
      setListFormat("");
      setPreview(null);
    }).finally(() => setPreviewing(false));
  };

  const submitImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = importText.trim();
    if (!trimmed) return;
    setImportBusy(true);
    setImportResult(null);
    void run(async () => {
      const looksJson = importFileKind === "json" || (importFileKind === "auto" && (trimmed.startsWith("{") || trimmed.startsWith("[")));
      let payload: Static<typeof SourceImportInput>;
      if (looksJson) {
        const parsed: unknown = JSON.parse(trimmed);
        const rawSources = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && Array.isArray((parsed as { sources?: unknown }).sources)
            ? (parsed as { sources: unknown[] }).sources
            : null;
        if (!rawSources) throw new Error("JSON 需为来源数组或包含 sources 字段");
        payload = {
          format: "json",
          sources: rawSources.map((entry) => {
            const item = entry as Record<string, unknown>;
            const isPush = item.deliveryMode === "push" || item.primaryProvider === "external_ingest";
            return {
              ...item,
              sourceGroup: item.sourceGroup ?? (importGroup || undefined),
              tier: item.tier ?? importTier,
              locale: item.locale ?? (importLocale || undefined),
              schedule: item.schedule ?? (!isPush && importSchedule ? { enabled: true } : undefined),
            } as Static<typeof SourceInput>;
          }),
        };
      } else {
        payload = {
          format: "opml",
          opml: trimmed,
          defaults: {
            ...(importGroup ? { sourceGroup: importGroup } : {}),
            tier: importTier,
            ...(importLocale ? { locale: importLocale } : {}),
            schedule: { enabled: importSchedule },
          },
        };
      }
      const result = await api<ImportResult>("/sources/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setImportResult(result);
    }).finally(() => setImportBusy(false));
  };

  const selectedHealth = selected?.health;
  const selectedHit = hitRate(selectedHealth);
  const selectedFailures = selectedHealth?.consecutiveFailures ?? 0;

  return (
    <>
      <Heading title="来源" note="定义收集范围，并在需要时采集或导入。">
        {canEdit && (
          <div className="heading-actions">
            <button onClick={() => setImporting(!importing)}>批量导入（OPML / JSON）</button>
            <button className="primary" onClick={() => setCreating(!creating)}>添加来源</button>
          </div>
        )}
      </Heading>
      {importing && (
        <form className="panel form-grid" onSubmit={submitImport}>
          <Field label="上传 OPML / XML / JSON 文件">
            <input
              type="file"
              accept=".opml,.xml,.json,application/json,text/xml,application/xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const lower = file.name.toLowerCase();
                void file.text().then((text) => {
                  setImportText(text);
                  setImportFileKind(lower.endsWith(".json") ? "json" : /\.(opml|xml)$/.test(lower) ? "opml" : "auto");
                  setImportResult(null);
                });
              }}
            />
          </Field>
          <Field label="默认频道分组">
            <select value={importGroup} onChange={(event) => setImportGroup(event.target.value)}>
              <option value="">未分组</option>
              {Object.entries(sourceGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="默认权威等级">
            <select value={importTier} onChange={(event) => setImportTier(event.target.value as "T1" | "T1_5" | "T2")}>
              {Object.entries(tierLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="默认语言">
            <select value={importLocale} onChange={(event) => setImportLocale(event.target.value)}>
              <option value="">未指定</option>
              {Object.entries(languages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <label className="check form-span">
            <input type="checkbox" checked={importSchedule} onChange={(event) => setImportSchedule(event.target.checked)} />
            自动采集
          </label>
          <div className="form-span">
            <Field label="或粘贴 OPML / JSON 内容">
              <textarea
                rows={6}
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  setImportFileKind("auto");
                }}
                placeholder="粘贴 OPML XML 或 JSON 来源数组…"
              />
            </Field>
          </div>
          <button className="primary" disabled={importBusy || !importText.trim()}>
            {importBusy ? "导入中…" : "开始导入"}
          </button>
          {importResult && (
            <div className="form-span" aria-live="polite">
              <p>
                导入完成：新增 {countOf(importResult.created)} 个，跳过 {countOf(importResult.skipped)} 个，错误{" "}
                {Array.isArray(importResult.errors) ? importResult.errors.length : importResult.errors} 条。
              </p>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
                <ul className="import-errors">
                  {importResult.errors.map((err, idx) => <li key={idx}>{formatImportError(err)}</li>)}
                </ul>
              )}
            </div>
          )}
        </form>
      )}
      {creating && (
        <form className="panel form-grid" onSubmit={submit} onChange={() => setPreview(null)}>
          <Field label="来源名称">
            <input name="label" required maxLength={100} />
          </Field>
          <Field label="采集方式">
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value;
                setProvider(next);
                setTargetType(next === "bluesky_appview" ? "account" : next === "feed" ? "feed" : "search");
                if (next !== "feed") setListFormat("");
              }}
            >
              <option value="kaix">Reddit · kaix</option>
              <option value="twitterapis">X · TwitterAPIs</option>
              <option value="bluesky_appview">Bluesky · 公开账号</option>
              <option value="newsnow">NewsNow · 热榜</option>
              <option value="feed">RSS / Atom</option>
              <option value="external_ingest">导入已筛选内容</option>
            </select>
          </Field>
          {["twitterapis", "kaix"].includes(provider) && <Field label="监测目标">
            <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
              <option value="search">搜索表达式</option>
              <option value="account">账号</option>
              {provider === "kaix" && <option value="community">社区</option>}
            </select>
          </Field>}
          {provider === "newsnow" ? <Field label="热榜">
            <select name="target">
              {Object.entries(webBoards).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field> : <Field label={provider === "external_ingest" ? "样本主题" : ({
            account: "账号", community: "社区", feed: "订阅或列表页 HTTPS URL", search: "搜索表达式",
          })[targetType] ?? "搜索表达式"}>
            <input name="target" required maxLength={targetType === "feed" ? 2000 : targetType === "search" ? 512 : targetType === "account" ? 253 : 100} />
          </Field>}
          {provider !== "external_ingest" && <label className="check">
            <input type="checkbox" name="schedule" />启用自动采集
          </label>}
          {(provider === "twitterapis" || provider === "kaix" && targetType !== "account") && (
            <label className="check">
              <input type="checkbox" name="fallbackProvider" value={provider === "twitterapis" ? "scrapebadger" : "red_crawler"} />
              配置备源 {provider === "twitterapis" ? "ScrapeBadger" : "red_crawler"} 备源
            </label>
          )}
          <Field label="权威等级">
            <select name="tier" defaultValue="T2">
              {Object.entries(tierLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="频道分组（可选）">
            <select name="sourceGroup" defaultValue="">
              <option value="">未分组</option>
              {Object.entries(sourceGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="语言（可选）">
            <select name="locale" defaultValue="">
              <option value="">未指定</option>
              {Object.entries(languages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="标签（逗号分隔 slug，可选）">
            <input name="tags" placeholder="ai, release-notes" maxLength={400} title="小写字母、数字、- 或 _，逗号分隔" />
          </Field>
          {provider !== "external_ingest" && <>
            <Field label="调度周期（秒，120–43200）">
              <input type="number" name="cadenceSeconds" min={120} max={43200} defaultValue={3600} required />
            </Field>
            <Field label="每次抓取上限（1–100）">
              <input type="number" name="pageSize" min={1} max={100} defaultValue={30} required />
            </Field>
          </>}
          <Field label="发布主体 ID（可选，同一主体共用）">
            <input name="ownerEntityId" pattern="[a-z0-9][a-z0-9_\-]{0,79}" maxLength={80} />
          </Field>
          {provider === "feed" && (
            <details className="form-span">
              <summary>网页/JSON 列表选择器（无 RSS 页面可选）</summary>
              <div className="sub-grid">
                <Field label="列表格式">
                  <select name="listFormat" value={listFormat} onChange={(event) => setListFormat(event.target.value)}>
                    <option value="">自动识别 RSS / Atom</option>
                    <option value="web_list">web_list（CSS 选择器）</option>
                    <option value="json_list">json_list（JSON 字段路径）</option>
                  </select>
                </Field>
                <Field label="列表项选择器 / 路径（items）">
                  <input name="listItems" required={Boolean(listFormat)} maxLength={160} placeholder={listFormat === "json_list" ? "data.items 或 $" : "article.post"} />
                </Field>
                <Field label="链接字段（link）">
                  <input name="listLink" required={Boolean(listFormat)} maxLength={160} placeholder={listFormat === "json_list" ? "url" : "a"} />
                </Field>
                <Field label="标题字段（title）">
                  <input name="listTitle" required={Boolean(listFormat)} maxLength={160} placeholder={listFormat === "json_list" ? "title" : "h2"} />
                </Field>
                <Field label="摘要字段（summary，可选）">
                  <input name="listSummary" maxLength={160} />
                </Field>
                <Field label="发布时间字段（publishedAt，可选）">
                  <input name="listPublishedAt" maxLength={160} />
                </Field>
                <Field label="作者字段（author，可选）">
                  <input name="listAuthor" maxLength={160} />
                </Field>
              </div>
            </details>
          )}
          <button disabled={previewing}>保存来源</button>
          <button disabled={previewing} value="preview">{previewing ? "试抓中…" : "预览来源"}</button>
          {preview && <div className="form-span" aria-live="polite">
            <p>{preview.mode === "fetched" ? `试抓 ${preview.items.length} 条` :
              preview.providerEnabled ? "配置有效" : "连接器未启用"}</p>
            {preview.items.length > 0 && <ol>{preview.items.map((item, index) =>
              <li key={index}>{item.title ?? item.url}</li>)}</ol>}
          </div>}
        </form>
      )}
      <div className="source-layout">
        <div className="source-list">
          <div className="filter-strip" role="group" aria-label="来源筛选">
            <select aria-label="按分组筛选" value={filterGroup} onChange={(event) => setFilterGroup(event.target.value)}>
              <option value="">全部分组</option>
              {Object.entries(sourceGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <label className="check">
              <input type="checkbox" checked={abnormalOnly} onChange={(event) => setAbnormalOnly(event.target.checked)} />
              仅看截断/异常
            </label>
            <span className="muted">
              {filteredSources.length === allSources.length ? `共 ${allSources.length} 个` : `显示 ${filteredSources.length} / ${allSources.length}`}
            </span>
          </div>
          {allSources.length > 0 && filteredSources.length === 0 && <Empty>当前筛选条件下没有来源。</Empty>}
          {filteredSources.map((source) => {
            const h = source.health;
            const rate = hitRate(h);
            const failures = h?.consecutiveFailures ?? 0;
            const meta = [
              source.platform,
              source.primaryProvider,
              source.tier,
              groupLabel(source.sourceGroup),
              localeLabel(source.locale),
              typeof h?.lastDurationMs === "number" ? `${Math.round(h.lastDurationMs)}ms` : null,
              rate ? `304 ${rate.pct}%` : null,
            ].filter(Boolean).join(" · ");
            return (
              <button
                className={`source-row ${selected?.id === source.id ? "selected" : ""}`}
                key={source.id}
                onClick={() => setSelectedId(source.id)}
              >
                <span className="source-icon">
                  <Radio size={20} />
                </span>
                <div>
                  <h2>{source.label}</h2>
                  <p>{meta}</p>
                  {failures > 0 && (
                    <p className="source-error">
                      连续失败 {failures} 次{h?.lastError ? `：${h.lastError}` : ""}
                    </p>
                  )}
                </div>
                <div className="source-badges">
                  {h?.lastTruncated && <span className="badge badge-warn">可能截断</span>}
                  {failures > 0 && <span className="badge badge-error">异常 ×{failures}</span>}
                  <span className="badge">
                    {source.state === "active"
                      ? "可用"
                      : source.state === "paused"
                        ? "已暂停"
                        : "已归档"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {selected && (
          <section className="panel source-detail">
            <h2>{selected.label}</h2>
            <p className="muted">
              {[
                selected.deliveryMode === "push" ? "导入样本" : selected.schedule?.enabled ? "自动采集" : "按需采集",
                selected.contentKind,
                tierLabels[selected.tier],
                groupLabel(selected.sourceGroup),
                localeLabel(selected.locale),
              ].filter(Boolean).join(" · ")}
            </p>
            {(selected.tags?.length ?? 0) > 0 && (
              <p className="muted">标签：{selected.tags.join(", ")}</p>
            )}
            {(typeof selectedHealth?.lastDurationMs === "number" || selectedHit || selectedHealth?.lastTruncated) && (
              <div className="health-row">
                {typeof selectedHealth?.lastDurationMs === "number" && (
                  <span>最近耗时 {Math.round(selectedHealth.lastDurationMs)}ms</span>
                )}
                {selectedHit && (
                  <span>304 命中率 {selectedHit.pct}%（{selectedHit.hits}/{selectedHit.total}）</span>
                )}
                {selectedHealth?.lastTruncated && <span className="badge badge-warn">可能截断</span>}
              </div>
            )}
            {selectedFailures > 0 && (
              <div className="alert" role="alert">
                <span>
                  连续失败 {selectedFailures} 次{selectedHealth?.lastError ? `：${selectedHealth.lastError}` : ""}
                </span>
              </div>
            )}
            <p className="target-text">
              {"query" in selected.target
                ? selected.target.query
                : "account" in selected.target
                  ? selected.target.account
                  : JSON.stringify(selected.target)}
            </p>
            {selected.lastCheckedAt && <p className="muted">最近检查 {new Date(selected.lastCheckedAt).toLocaleString("zh-CN")}</p>}
            {selected.lastSuccessAt && <p className="muted">最近采集成功 {new Date(selected.lastSuccessAt).toLocaleString("zh-CN")}</p>}
            {canEdit && selected.state !== "archived" && <details>
              <summary>编辑来源属性</summary>
              <form key={`${selected.id}:${selected.revision}`} onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const maxItemsRaw = String(form.get("maxItems") ?? "").trim();
                const nextFetchPolicy = maxItemsRaw
                  ? { ...(selected.fetchPolicy ?? {}), maxItems: Number(maxItemsRaw) }
                  : Object.fromEntries(Object.entries(selected.fetchPolicy ?? {}).filter(([k]) => k !== "maxItems"));
                void run(() => api(`/sources/${selected.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    revision: selected.revision,
                    tier: form.get("tier"),
                    ownerEntityId: form.get("ownerEntityId") || null,
                    sourceGroup: form.get("sourceGroup") || null,
                    locale: form.get("locale") || null,
                    tags: parseTags(form.get("tags")),
                    fetchPolicy: nextFetchPolicy,
                  }),
                }));
              }}>
                <Field label="权威等级">
                  <select name="tier" defaultValue={selected.tier}>
                    {Object.entries(tierLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </Field>
                <Field label="频道分组">
                  <select name="sourceGroup" defaultValue={selected.sourceGroup ?? ""}>
                    <option value="">未分组</option>
                    {Object.entries(sourceGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </Field>
                <Field label="语言">
                  <select name="locale" defaultValue={selected.locale ?? ""}>
                    <option value="">未指定</option>
                    {Object.entries(languages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </Field>
                <Field label="标签（逗号分隔 slug）">
                  <input name="tags" defaultValue={(selected.tags ?? []).join(", ")} maxLength={400} placeholder="ai, release-notes" />
                </Field>
                <Field label="抓取条数上限（fetchPolicy.maxItems，1–100）">
                  <input type="number" name="maxItems" min={1} max={100} defaultValue={selected.fetchPolicy?.maxItems ?? ""} placeholder="默认" />
                </Field>
                <Field label="发布主体 ID（可选，同一主体共用）">
                  <input name="ownerEntityId" defaultValue={selected.ownerEntityId ?? ""} pattern="[a-z0-9][a-z0-9_\-]{0,79}" maxLength={80} />
                </Field>
                <button>保存属性</button>
              </form>
            </details>}
            {canEdit && selected.deliveryMode === "pull" && selected.state !== "archived" && (
              <button onClick={() => void run(() => api(`/sources/${selected.id}`, {
                method: "PATCH",
                body: JSON.stringify({ revision: selected.revision, schedule: { ...selected.schedule, enabled: !selected.schedule?.enabled } }),
              }))}>{selected.schedule?.enabled ? "关闭自动采集" : "开启自动采集"}</button>
            )}
            {budget && <details>
              <summary>供应商预算 · {budget.provider}</summary>
              {budget.enabled && <ul className="quota-meters">
                {quotaFields.map(([limitKey, usageKey, label]) => {
                  const used = budget[usageKey], limit = budget[limitKey];
                  if (used === undefined) return null;
                  return <li key={limitKey}>
                    <span>{label} · {used.toLocaleString()} / {limit.toLocaleString()}</span>
                    {limit > 0 && <meter aria-label={label} max={limit} value={Math.min(used, limit)} />}
                  </li>;
                })}
              </ul>}
              <form key={`${budget.provider}:${budget.revision}`} onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const amounts = Object.fromEntries(Object.values(budgetFields).map(([name]) => [name, Number(form.get(name))]));
                void run(() => api(`/sources/budgets/${budget.provider}`, {
                  method: "PUT",
                  body: JSON.stringify({ ...amounts, enabled: form.has("enabled"), revision: budget.revision }),
                }));
              }}>
                <label className="check"><input type="checkbox" name="enabled" defaultChecked={budget.enabled} />开启额度</label>
                {Object.entries(budgetFields).map(([key, [name, label]]) => <Field key={key} label={label}>
                  <input type="number" name={name} min={0} defaultValue={budget[key as keyof typeof budgetFields]} required />
                </Field>)}
                <button>保存预算</button>
              </form>
            </details>}
            {canEdit &&
              selected.state === "active" &&
              selected.deliveryMode === "pull" && (
                <form
                  key={selected.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const body = JSON.stringify({
                      from: new Date(String(form.get("from"))).toISOString(),
                      to: new Date(String(form.get("to"))).toISOString(),
                      limit: Number(form.get("limit")),
                      includeComments: form.get("comments") === "on",
                      useFallback: form.has("useFallback") || undefined,
                    });
                    const signature = `${selected.id}:${body}`;
                    if (collectionRequest.current?.body !== signature) {
                      collectionRequest.current = { body: signature, key: crypto.randomUUID() };
                    }
                    const key = collectionRequest.current.key;
                    setCollecting(true);
                    void run(async () => {
                      try {
                        await api(`/sources/${selected.id}/collect`, {
                          method: "POST", headers: { "Idempotency-Key": key }, body,
                        });
                        if (collectionRequest.current?.key === key) collectionRequest.current = null;
                      } finally { setCollecting(false); }
                    });
                  }}
                >
                  <Field label="开始日期">
                    <input
                      name="from"
                      type="date"
                      defaultValue={new Date(openedAt - 86400000)
                        .toISOString()
                        .slice(0, 10)}
                      required
                    />
                  </Field>
                  <Field label="结束日期（不含）">
                    <input
                      name="to"
                      type="date"
                      defaultValue={new Date(openedAt)
                        .toISOString()
                        .slice(0, 10)}
                      required
                    />
                  </Field>
                  <Field label="主帖上限">
                    <input
                      name="limit"
                      type="number"
                      min={1}
                      max={selected.primaryProvider === "twitterapis" ? 20 : 100}
                      defaultValue={selected.primaryProvider === "twitterapis" ? 20 : 25}
                      required
                    />
                  </Field>
                  {selected.primaryProvider === "kaix" && <label className="check">
                    <input name="comments" type="checkbox" />
                    连带高赞评论（每帖最多 15 条）
                  </label>}
                  {selected.fallbackProvider && (
                    <label className="check">
                      <input type="checkbox" name="useFallback" />使用备源 {selected.fallbackProvider}
                    </label>
                  )}
                  <button disabled={collecting}>{collecting ? "正在提交…" : "开始采集"}</button>
                </form>
              )}
            {canEdit &&
              selected.state === "active" &&
              selected.deliveryMode === "push" && (
                <Field label="导入规范 JSON 文件">
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void run(async () => {
                          const payload = JSON.parse(await file.text());
                          return api(`/sources/${selected.id}/ingest`, {
                            method: "POST",
                            headers: { "Idempotency-Key": crypto.randomUUID() },
                            body: JSON.stringify(payload),
                          });
                        });
                    }}
                  />
                </Field>
              )}
            {canEdit && selected.state !== "archived" && (
              <button
                className="quiet"
                onClick={() =>
                  void run(async () => {
                    await api(`/sources/${selected.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        state:
                          selected.state === "paused" ? "active" : "paused",
                        revision: selected.revision,
                      }),
                    });
                    setSelectedId(null);
                  })
                }
              >
                {selected.state === "paused" ? "启用来源" : "暂停来源"}
              </button>
            )}
            <details open>
              <summary>最近任务</summary>
              {jobs.data?.jobs.map((job) => (
                <div className="job" key={job.id}>
                  <span>
                    {job.provider_state.phase === "unknown"
                      ? "收费结果待核查，已停发"
                      : ({
                          queued: "等待执行",
                          running: "采集中",
                          retrying: "稍后重试",
                          succeeded: "已完成",
                          failed: "采集失败",
                          cancelled: "已取消",
                        }[job.status] ?? "待核查")}
                  </span>
                  <span>{job.records_processed} 条</span>
                  {job.error && <p role="status">{job.error}</p>}
                  {canEdit && selected.state === "active" && ["failed", "cancelled"].includes(job.status) && (() => {
                    const phase = job.provider_state.phase;
                    const continuing = phase === "running" || phase === "reading";
                    const unresolved = phase === "unknown" || phase === "starting";
                    return <button onClick={() => {
                      if (unresolved && !window.confirm("请先核对供应商账单。再次请求可能重复扣费，确定重试？")) return;
                      void run(() => api(`/source-jobs/${job.id}/${continuing ? "continue" : "retry"}`, {
                        method: "POST", body: JSON.stringify({ acknowledgePotentialCharge: unresolved }),
                      }));
                    }}>{continuing ? "继续读取" : "重试任务"}</button>;
                  })()}
                </div>
              ))}
            </details>
          </section>
        )}
      </div>
      {allSources.length === 0 && (
        <Empty>添加一个来源，开始积累研究证据。</Empty>
      )}
    </>
  );
}
