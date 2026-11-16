import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radar, ArrowUpRight } from "lucide-react";
import type { CollectionSource } from "../../../../packages/contracts/src/source-content";
import { Field, Heading, Empty } from "../ui";
import { api, type Run } from "../api";
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
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      api<{ projects: { id: string; name: string; filter: unknown }[] }>(
        "/projects",
      ),
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState("");
  const overview = useQuery({
    queryKey: ["overview", selected],
    enabled: !!selected,
    queryFn: () =>
      api<{
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
  return (
    <>
      <Heading title="监测项目" note="从一个明确的问题开始，持续整理相关证据。">
        {canEdit && (
          <button className="primary" onClick={() => setCreating(!creating)}>
            创建项目
          </button>
        )}
      </Heading>
      {creating && (
        <form
          className="panel form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await api("/projects", {
                method: "POST",
                body: JSON.stringify({
                  name: form.get("name"),
                  sourceIds: form.getAll("sources"),
                  filter: {
                    anyTerms: terms(form.get("anyTerms")),
                    allTerms: terms(form.get("allTerms")),
                    exclusions: terms(form.get("exclusions")),
                  },
                }),
              });
              setCreating(false);
            });
          }}
        >
          <Field label="研究主题">
            <input
              name="name"
              required
              maxLength={100}
              placeholder="例如：AI 编程工具的使用反馈"
            />
          </Field>
          <Field label="任一提及">
            <input name="anyTerms" placeholder="词组以逗号分隔" />
          </Field>
          <Field label="同时包含">
            <input name="allTerms" />
          </Field>
          <Field label="排除词">
            <input name="exclusions" />
          </Field>
          <fieldset>
            <legend>关联来源</legend>
            {sources.data?.sources.map((source) => (
              <label key={source.id} className="check">
                <input type="checkbox" name="sources" value={source.id} />
                {source.label}
              </label>
            ))}
          </fieldset>
          <button>保存项目</button>
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
              onClick={() => setSelected(project.id)}
            >
              <Radar size={20} />
              <h2>{project.name}</h2>
              <p>查看库内命中样本</p>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
      )}
      {overview.data && (
        <section className="panel">
          <p className="eyebrow">已存命中内容</p>
          <div className="big-number">
            {overview.data.facets.find(
              (facet) =>
                facet.day_group === 1 &&
                facet.platform_group === 1 &&
                facet.kind_group === 1,
            )?.count ?? 0}
          </div>
          <p className="muted">
            按内容节点计数，附属评论单独计入。当前尚未合并为讨论根帖。
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
        </section>
      )}
    </>
  );
}
