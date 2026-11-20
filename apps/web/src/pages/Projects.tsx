import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Radar, ArrowUpRight } from "lucide-react";
import type { CollectionSource, Filter } from "../../../../packages/contracts/src/source-content";
import { Field, Heading, Empty } from "../ui";
import { api, type Run } from "../api";
import PulseChart from "../components/PulseChart";
import { dailyBuckets } from "../components/buckets";
type Project = {
  id: string;
  name: string;
  filter: Filter;
  revision: number;
  source_ids: string[];
  thread_aware: boolean;
  include_push_in_trends: boolean;
};
const terms = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
export default function Projects({
  run,
  canEdit,
}: {
  run: Run;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      api<{ projects: Project[] }>(
        "/projects",
      ),
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<Project | null>(null),
    [deleting, setDeleting] = useState(false);
  const project = projects.data?.projects.find(({ id }) => id === selected);
  const overview = useQuery({
    queryKey: ["overview", selected, project?.revision],
    enabled: !!project,
    queryFn: () =>
      api<{
        contentCount: number;
        matchedContentCount: number;
        dayPlatformFacets?: { day: string; platform: string; count: number; matchedContentCount: number }[];
        facets: {
          day_group: number;
          platform_group: number;
          kind_group: number;
          count: number;
          day: string | null;
          platform: string | null;
          kind: string | null;
        }[];
      }>(`/projects/${selected}/overview`),
  });
  const dated = overview.data?.facets.filter(facet => facet.day_group === 0 && facet.day) ?? [];
  const samples = new Map<string, { platform: string; count: number }[]>();
  for (const { day, platform, count } of overview.data?.dayPlatformFacets ?? []) {
    const bucket = day.slice(0, 10);
    if (!samples.has(bucket)) samples.set(bucket, []);
    samples.get(bucket)!.push({ platform, count });
  }
  const last = Date.parse(dated.at(-1)?.day ?? "");
  const buckets = samples.size ? dailyBuckets(
    Math.max(last - 29 * 86_400_000, Date.parse(dated[0]?.day ?? "")),
    last + 86_400_000,
    [...samples].map(([bucket, byPlatform]) => ({ bucket, byPlatform })),
  ) : [];
  const drillDown = (from: string, platform?: string) => {
    const to = new Date(Date.parse(from) + 86_400_000).toISOString();
    const url = new URLSearchParams({ projectId: selected, from, to });
    if (platform) url.set("platform", platform);
    if (!project?.include_push_in_trends) url.set("deliveryMode", "pull");
    return `/content?${url}`;
  };
  return (
    <>
      <Heading title="监测项目" note="从一个明确的问题开始，持续整理相关证据。">
        {canEdit && (
          <button className="primary" onClick={() => { setEditing(null); setCreating(!creating); }}>
            创建项目
          </button>
        )}
      </Heading>
      {(creating || editing) && (
        <form
          className="panel form-grid"
          key={editing?.id ?? "new"}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              const saved = await api<Project>(editing ? `/projects/${editing.id}` : "/projects", {
                method: editing ? "PATCH" : "POST",
                body: JSON.stringify({
                  revision: editing?.revision,
                  threadAware: form.has("threadAware"),
                  includePushInTrends: form.has("includePushInTrends"),
                  name: form.get("name"),
                  sourceIds: form.getAll("sources"),
                  filter: {
                    ...editing?.filter,
                    anyTerms: terms(form.get("anyTerms")),
                    allTerms: terms(form.get("allTerms")),
                    exclusions: terms(form.get("exclusions")),
                  },
                }),
              });
              setCreating(false);
              setEditing(null);
              if (editing) setSelected(saved.id);
            });
          }}
        >
          <Field label="研究主题">
            <input
              name="name"
              defaultValue={editing?.name}
              required
              maxLength={100}
              placeholder="例如：AI 编程工具的使用反馈"
            />
          </Field>
          <Field label="任一提及">
            <input name="anyTerms" defaultValue={editing?.filter.anyTerms?.join(", ")} placeholder="至少连续 2 个字母或数字，词组以逗号分隔" />
          </Field>
          <Field label="同时包含">
            <input name="allTerms" defaultValue={editing?.filter.allTerms?.join(", ")} />
          </Field>
          <Field label="排除词">
            <input name="exclusions" defaultValue={editing?.filter.exclusions?.join(", ")} />
          </Field>
          <fieldset>
            <legend>关联来源</legend>
            {sources.data?.sources.map((source) => (
              <label key={source.id} className="check">
                <input type="checkbox" name="sources" value={source.id} defaultChecked={editing?.source_ids.includes(source.id)} />
                {source.label}
              </label>
            ))}
          </fieldset>
          <label className="check"><input type="checkbox" name="threadAware" defaultChecked={editing?.thread_aware ?? true} />按讨论根帖归组</label>
          <label className="check">
            <input type="checkbox" name="includePushInTrends" defaultChecked={editing?.include_push_in_trends ?? false} />
            统计纳入导入样本
          </label>
          <button>保存项目</button>
          {editing && <button type="button" onClick={() => setEditing(null)}>取消编辑</button>}
        </form>
      )}
      {projects.error && <p role="alert">{projects.error.message}</p>}
      {projects.data?.projects.length === 0 ? (
        <Empty>还没有监测项目。先添加来源，再建立一个研究主题。</Empty>
      ) : (
        <div className="cards">
          {projects.data?.projects.map((project) => (
            <button
              key={project.id}
              className={`project-card ${selected === project.id ? "selected" : ""}`}
              onClick={() => { setSelected(project.id); setDeleting(false); }}
            >
              <Radar size={20} />
              <h2>{project.name}</h2>
              <p>查看库内命中样本</p>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
      )}
      {project && overview.isPending && <p role="status">正在读取项目统计…</p>}
      {overview.error && <p role="alert">{overview.error.message}</p>}
      {overview.data && project && (
        <section className="panel">
          <p className="eyebrow">已存命中内容</p>
          <div className="big-number">{overview.data.contentCount}</div>
          <p className="muted">
            {project.thread_aware ? `按可见讨论根帖归组 · ${overview.data.matchedContentCount} 个命中节点` : "按内容节点计数"}
            {project.include_push_in_trends ? " · 包含导入样本" : " · 统计仅含在线来源"}
          </p>
          <div className="facets">
            {overview.data.facets
              .filter((facet) => facet.platform_group === 0)
              .map((facet) => (
                <span key={facet.platform}>
                  {facet.platform} <strong>{facet.count}</strong>
                </span>
              ))}
          </div>
          {buckets.length > 0 && <>
            <p className="muted">UTC 日期 · 最近有样本的 30 天 · 斜线表示覆盖未知</p>
            <PulseChart buckets={buckets} onPick={({ from, platform }) => navigate(drillDown(from, platform))} />
          </>}
          <div className="facets" aria-label="按日命中">
            {dated.slice(-30).map(facet => {
              const from = new Date(facet.day!).toISOString();
              return <Link key={from} to={drillDown(from)}>{from.slice(0, 10)} · {facet.count}</Link>;
            })}
          </div>
          <div className="facets">
            <Link to={`/content?projectId=${project.id}`}>查看项目内容 →</Link>
            {canEdit && (
              <>
                <button onClick={() => { setCreating(false); setEditing(project); }}>编辑项目</button>
                <button onClick={() => setDeleting(!deleting)}>删除项目</button>
              </>
            )}
            {deleting && <button onClick={() => void run(async () => {
              await api(`/projects/${project.id}?revision=${project.revision}`, { method: "DELETE" });
              setDeleting(false);
              setSelected("");
            })}>确认删除项目</button>}
          </div>
        </section>
      )}
    </>
  );
}
