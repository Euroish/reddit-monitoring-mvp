import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Copy, X } from "lucide-react";
import type { Actor } from "../../../../packages/contracts/src/source-content";
import { api, type Run } from "../api";
import { formatExactTime, sourceGroups } from "../sourceLabels";
import { Empty } from "../ui";
import ReaderDrawer from "../components/ReaderDrawer";
import { StoryRow, TimelineRow } from "../components/StoryCard";
import type {
  ContentFeedPage,
  OpenAuthFn,
  PublicSourceSummary,
  ReaderPreview,
  StoryEvidenceView,
  StoryFeedPage,
} from "../types";

const viewTitles = {
  latest: "今日精选",
  timeline: "全量时间线",
  hot: "48 小时热度",
  digest: "08:00 日报",
} as const;

type FeedView = keyof typeof viewTitles;
type Density = "comfortable" | "compact";

const DENSITY_KEY = "signal.feed.density";

function loadDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export default function Stories({
  user,
  run,
  openAuth,
  publicSources,
}: {
  user: Actor | null;
  run: Run;
  openAuth: OpenAuthFn;
  publicSources: PublicSourceSummary[];
}) {
  const [params, setParams] = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const client = useQueryClient();

  const [density, setDensity] = useState<Density>(loadDensity);
  const [reader, setReader] = useState<ReaderPreview | null>(null);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [statusNotice, setStatusNotice] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const rawView = params.get("view");
  const view: FeedView =
    rawView === "hot" || rawView === "digest" || rawView === "timeline" ? rawView : "latest";
  const date = view === "digest" ? params.get("date") : null;
  const sourceGroup = params.get("sourceGroup") ?? "";
  const tier = params.get("tier") ?? "";
  const language = params.get("language") ?? "";
  const sourceId = params.get("sourceId") ?? "";

  const sourceMap = useMemo(
    () => new Map(publicSources.map((src) => [src.id, src])),
    [publicSources],
  );
  const activeSource = sourceId ? sourceMap.get(sourceId) : undefined;

  const setDensityMode = (next: Density) => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* Storage unavailable */
    }
  };

  const updateFilter = useCallback(
    (key: "sourceGroup" | "tier" | "language" | "sourceId", value: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      setParams(next);
    },
    [params, setParams],
  );

  const buildUrl = useCallback(
    (nextView: FeedView, nextDate?: string, nextGroup?: string) => {
      const next = new URLSearchParams();
      if (nextView !== "latest") next.set("view", nextView);
      if (nextDate) next.set("date", nextDate);
      const grp = nextGroup !== undefined ? nextGroup : sourceGroup;
      if (grp) next.set("sourceGroup", grp);
      if (tier) next.set("tier", tier);
      if (language) next.set("language", language);
      const qs = next.toString();
      return qs ? `/?${qs}` : "/";
    },
    [sourceGroup, tier, language],
  );

  const bookmarkContent = useCallback(
    (contentId: string) => {
      if (!user) {
        openAuth("login", "登录后可收藏内容到我的研究。");
        return;
      }
      if (savingRef.current) return;
      savingRef.current = true;
      const path = `/workspace/annotations/${contentId}`;
      void (async () => {
        try {
          const { annotation } = await api<{
            annotation: { note: string; revision: number; favorite: boolean } | null;
          }>(path);
          const nextFav = !annotation?.favorite;
          await api(path, {
            method: "PUT",
            body: JSON.stringify({
              note: annotation?.note ?? "",
              revision: annotation?.revision ?? 0,
              favorite: nextFav,
            }),
          });
          setSavedIds((prev) => ({ ...prev, [contentId]: nextFav }));
          await client.invalidateQueries({ queryKey: ["annotations"] });
          await client.invalidateQueries({ queryKey: ["annotation", contentId] });
          setStatusNotice(nextFav ? "已收藏到我的研究。" : "已取消收藏。");
        } catch (err) {
          setStatusNotice(err instanceof Error ? err.message : "收藏操作失败，请重试。");
        } finally {
          savingRef.current = false;
        }
      })();
    },
    [user, openAuth, client],
  );

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        reader ||
        document.querySelector('[role="dialog"], dialog[open]') ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (!["j", "k", "o", "s", "m"].includes(key)) return;
      const cards = [...(listRef.current?.querySelectorAll<HTMLElement>("article[data-content-id]") ?? [])];
      if (!cards.length) return;
      const index = cards.findIndex((card) => card.contains(document.activeElement));
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = index < 0 ? (key === "j" ? 0 : cards.length - 1) : index + (key === "j" ? 1 : -1);
        cards[Math.max(0, Math.min(cards.length - 1, next))].focus();
        return;
      }
      if (index < 0 || event.repeat) return;
      const card = cards[index];
      event.preventDefault();
      if (key === "o") card.querySelector<HTMLButtonElement>("h2 button")?.click();
      if (key === "m") card.querySelector<HTMLElement>("details summary")?.click();
      if (key === "s") bookmarkContent(card.dataset.contentId!);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [reader, bookmarkContent]);

  const storiesQuery = useInfiniteQuery({
    queryKey: ["stories", view, date, sourceGroup, tier, language, sourceId],
    enabled: view !== "timeline",
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        view: view === "timeline" ? "latest" : view,
        limit: "30",
        ...(pageParam > 0 ? { offset: String(pageParam) } : {}),
        ...(date ? { date } : {}),
        ...(sourceGroup ? { sourceGroup } : {}),
        ...(tier ? { tier } : {}),
        ...(language ? { language } : {}),
        ...(sourceId ? { sourceId } : {}),
      });
      return api<StoryFeedPage>(`/content/stories?${qs}`);
    },
    getNextPageParam: (lastPage) =>
      typeof lastPage.nextOffset === "number" ? lastPage.nextOffset : undefined,
    staleTime: 30_000,
  });

  const timelineQuery = useInfiniteQuery({
    queryKey: ["content-feed", sourceGroup, tier, language, sourceId],
    enabled: view === "timeline",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        limit: "30",
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(sourceGroup ? { sourceGroup } : {}),
        ...(tier ? { tier } : {}),
        ...(language ? { language } : {}),
        ...(sourceId ? { sourceId } : {}),
      });
      return api<ContentFeedPage>(`/content/feed?${qs}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const stories = useMemo(
    () => (storiesQuery.data?.pages ?? []).flatMap((page) => page.items),
    [storiesQuery.data],
  );
  const firstStoryPage = storiesQuery.data?.pages[0];
  const totalStories = firstStoryPage?.totalCount;

  const timelineItems = useMemo(
    () => (timelineQuery.data?.pages ?? []).flatMap((page) => page.items),
    [timelineQuery.data],
  );

  const activeQuery = view === "timeline" ? timelineQuery : storiesQuery;
  const pageTitle = sourceGroup
    ? (sourceGroups[sourceGroup as keyof typeof sourceGroups] ?? sourceGroup)
    : viewTitles[view];

  const copyDigest = async () => {
    if (!firstStoryPage || !stories.length) return;
    const fmtLink = (item: StoryEvidenceView) => {
      const title = item.title.replace(/[\r\n]+/gu, " ").replace(/[\\[\]]/gu, "\\$&");
      return item.url && /^https?:\/\//i.test(item.url)
        ? `[${title}](<${item.url.replace(/[<>]/gu, encodeURIComponent)}>)`
        : title;
    };
    const markdown = [
      `# ${firstStoryPage.to.slice(0, 10)} 日报`,
      ...stories.map((story) =>
        [
          `## ${fmtLink(story.representative)}`,
          `${story.representative.tier} · ${story.representative.sourceLabel}`,
          ...story.related.map((item) => `- ${fmtLink(item)}`),
        ].join("\n"),
      ),
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("已复制 Markdown");
    } catch {
      setCopyStatus("复制失败，请重试");
    }
  };

  const remaining =
    typeof totalStories === "number" ? Math.max(0, totalStories - stories.length) : null;

  return (
    <div className="editorial-column">
      <div className="mobile-channel-strip" aria-label="移动端视图与频道">
        {(Object.entries(viewTitles) as [FeedView, string][]).map(([key, label]) => (
          <Link
            key={key}
            to={buildUrl(key)}
            className={`strip-pill${view === key && !sourceGroup ? " is-active" : ""}`}
          >
            {label}
          </Link>
        ))}
        {Object.entries(sourceGroups).map(([key, label]) => (
          <Link
            key={key}
            to={buildUrl(view, undefined, sourceGroup === key ? "" : key)}
            className={`strip-pill${sourceGroup === key ? " is-active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <header className="feed-header">
        <div className="feed-header-main">
          <div className="feed-title-row">
            <h1>{pageTitle}</h1>
            {sourceGroup && view !== "latest" && (
              <span className="feed-view-tag">{viewTitles[view]}</span>
            )}
          </div>
          <div className="feed-subtitle">
            {view !== "timeline" && firstStoryPage ? (
              <>
                {typeof totalStories === "number" && (
                  <span className="tabular">共 {totalStories.toLocaleString("zh-CN")} 条</span>
                )}
                <span>
                  {formatExactTime(firstStoryPage.from)} 至 {formatExactTime(firstStoryPage.to)}
                </span>
                {view === "digest" && (
                  <Link
                    to={buildUrl("digest", firstStoryPage.from.slice(0, 10))}
                    className="inline-link"
                    onClick={() => setCopyStatus("")}
                  >
                    前一日
                  </Link>
                )}
              </>
            ) : (
              <span>{view === "timeline" ? "按发布时间倒序浏览全量已采集记录" : view === "hot" ? "最近 48 小时多源热度排行" : view === "digest" ? "每日 08:00 编辑部早报" : "近 7 天多源防刷屏精选 · 权威源保底露出"}</span>
            )}
            {activeSource && (
              <button
                type="button"
                className="active-filter-chip"
                onClick={() => updateFilter("sourceId", "")}
              >
                来源：{activeSource.label} <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="feed-controls">
          {view === "digest" && stories.length > 0 && (
            <button type="button" className="compact-btn" onClick={() => void copyDigest()}>
              {copyStatus ? <Check size={13} /> : <Copy size={13} />}
              <span>{copyStatus || "复制 Markdown"}</span>
            </button>
          )}
          <div className="segmented" role="group" aria-label="阅读密度">
            <button
              type="button"
              aria-pressed={density === "comfortable"}
              className={density === "comfortable" ? "is-active" : ""}
              onClick={() => setDensityMode("comfortable")}
            >
              舒适
            </button>
            <button
              type="button"
              aria-pressed={density === "compact"}
              className={density === "compact" ? "is-active" : ""}
              onClick={() => setDensityMode("compact")}
            >
              紧凑
            </button>
          </div>
        </div>
      </header>

      <div className="feed-filter-bar" role="group" aria-label="信息流筛选">
        <div className="segmented" role="group" aria-label="来源等级">
          {[
            ["", "全部"],
            ["T1", "T1 官方"],
            ["T1_5", "T1.5"],
          ].map(([val, label]) => (
            <button
              key={val || "all"}
              type="button"
              aria-pressed={tier === val}
              className={tier === val ? "is-active" : ""}
              onClick={() => updateFilter("tier", val)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="内容语言">
          {[
            ["", "全部"],
            ["zh", "中文"],
            ["en", "EN"],
          ].map(([val, label]) => (
            <button
              key={val || "all"}
              type="button"
              aria-pressed={language === val}
              className={language === val ? "is-active" : ""}
              onClick={() => updateFilter("language", val)}
            >
              {label}
            </button>
          ))}
        </div>

        {(sourceGroup || tier || language || sourceId) && (
          <button
            type="button"
            className="quiet clear-filters-btn"
            onClick={() => {
              const next = new URLSearchParams(params);
              for (const k of ["sourceGroup", "tier", "language", "sourceId"]) next.delete(k);
              setParams(next);
            }}
          >
            重置筛选
          </button>
        )}
      </div>

      {statusNotice && (
        <p role="status" className="status-toast">
          {statusNotice}
        </p>
      )}

      {activeQuery.error && (
        <div role="alert" className="alert">
          <span>{activeQuery.error.message}</span>
          <button type="button" onClick={() => void activeQuery.refetch()}>
            重试
          </button>
        </div>
      )}

      {activeQuery.isPending && (
        <p role="status" className="muted loading-note">
          正在读取信息流…
        </p>
      )}

      {!activeQuery.isPending && !activeQuery.error && (
        <>
          {view !== "timeline" && stories.length === 0 && (
            <Empty>当前筛选条件下暂无事件报道。</Empty>
          )}
          {view === "timeline" && timelineItems.length === 0 && (
            <Empty>当前筛选条件下暂无已入库记录。</Empty>
          )}

          <div className="feed-stream" ref={listRef}>
            {view !== "timeline"
              ? stories.map((story) => (
                  <StoryRow
                    key={story.storyKey}
                    story={story}
                    view={view}
                    density={density}
                    saved={Boolean(savedIds[story.representative.id])}
                    onOpen={setReader}
                    onBookmark={bookmarkContent}
                    onFilterSource={(id) => updateFilter("sourceId", id)}
                  />
                ))
              : timelineItems.map((item) => {
                  const firstObs = item.observations[0];
                  const source = firstObs ? sourceMap.get(firstObs.sourceId) : undefined;
                  return (
                    <TimelineRow
                      key={item.id}
                      item={item}
                      source={source}
                      density={density}
                      saved={Boolean(savedIds[item.id])}
                      onOpen={setReader}
                      onBookmark={bookmarkContent}
                      onFilterSource={(id) => updateFilter("sourceId", id)}
                    />
                  );
                })}
          </div>

          {activeQuery.hasNextPage && (
            <div className="load-more-wrap">
              <button
                type="button"
                className="load-more-btn"
                disabled={activeQuery.isFetchingNextPage}
                onClick={() => void activeQuery.fetchNextPage()}
              >
                {activeQuery.isFetchingNextPage
                  ? "正在加载更多…"
                  : remaining !== null && remaining > 0
                    ? `加载更多（剩余 ${remaining.toLocaleString("zh-CN")} 条）`
                    : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}

      {reader && (
        <ReaderDrawer
          preview={reader}
          user={user}
          run={run}
          openAuth={openAuth}
          onSelectRelated={(item) =>
            setReader({
              id: item.id,
              title: item.title,
              url: item.url,
              author: item.author,
              sourceLabel: item.sourceLabel,
              tier: item.tier,
              publishedAt: item.publishedAt,
              discoveredAt: item.discoveredAt,
              thumbnail: item.thumbnail,
              platform: item.platform,
            })
          }
          onClose={() => setReader(null)}
        />
      )}
    </div>
  );
}
