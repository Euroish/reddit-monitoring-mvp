import { ArrowUpRight, Bookmark, BookOpen } from "lucide-react";
import type { PublicContent } from "../../../../packages/contracts/src/source-content";
import {
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
  tierShort,
} from "../sourceLabels";
import type { PublicSourceSummary, ReaderPreview, StoryItemView } from "../types";

const badgeLabels = { surge: "飙升", rising: "升温", new: "新上榜" } as const;

function StoryMicrocharts({ story }: { story: StoryItemView }) {
  const { tierBreakdown, sparkline48h } = story;
  if (!tierBreakdown || sparkline48h?.length !== 8) return null;
  const tiers = ["T1", "T1_5", "T2"] as const;
  const total = tiers.reduce((sum, tier) => sum + tierBreakdown[tier], 0);
  const peak = Math.max(...sparkline48h, 0.01);
  const points = sparkline48h
    .map((value, index) => `${2 + index * 11},${13 - (11 * value) / peak}`)
    .join(" ");

  return (
    <div className="story-microcharts">
      {total > 0 && (
        <span className="microchart-group">
          <span className="microchart-label" aria-hidden="true">来源分布</span>
          <svg
            width="64"
            height="14"
            viewBox="0 0 64 14"
            role="img"
            aria-label={`来源分布：${tiers.map((tier) => `${tier} ${tierBreakdown[tier]}`).join("，")}`}
          >
            <title>{tiers.map((tier) => `${tier}：${tierBreakdown[tier]}`).join("，")}</title>
            {tiers.map((tier, index) => (
              <rect
                key={tier}
                className={`story-tier-${tier.toLowerCase()}`}
                x={(64 * tiers.slice(0, index).reduce((sum, earlier) => sum + tierBreakdown[earlier], 0)) / total}
                y="4"
                width={(64 * tierBreakdown[tier]) / total}
                height="6"
                rx="1"
              />
            ))}
          </svg>
        </span>
      )}
      <span className="microchart-group">
        <span className="microchart-label" aria-hidden="true">48h 走势</span>
        <svg
          width="80"
          height="14"
          viewBox="0 0 80 14"
          role="img"
          aria-label={`已采样热度，从早到晚每 6 小时：${sparkline48h.map((value) => value.toFixed(2)).join("，")}`}
        >
          <title>已采样热度 · 每 6 小时</title>
          <path className="story-chart-guide" d="M2 13H78" />
          <polyline className="story-chart-line" points={points} fill="none" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

export function StoryRow({
  story,
  view,
  density,
  saved,
  onOpen,
  onBookmark,
  onFilterSource,
}: {
  story: StoryItemView;
  view: "latest" | "hot" | "digest";
  density: "comfortable" | "compact";
  saved: boolean;
  onOpen: (preview: ReaderPreview) => void;
  onBookmark: (contentId: string) => void;
  onFilterSource: (sourceId: string) => void;
}) {
  const item = story.representative;
  const href = safeHttpUrl(item.url);
  const thumb = safeHttpUrl(item.thumbnail);
  const timestamp = item.publishedAt ?? item.discoveredAt;
  const showMicrocharts = story.sourceCount >= 2 || view === "hot";
  const pct =
    story.change6h !== null
      ? new Intl.NumberFormat("zh-CN", { style: "percent", signDisplay: "exceptZero" }).format(story.change6h)
      : null;

  const openDrawer = () =>
    onOpen({
      id: item.id,
      title: item.title,
      url: item.url,
      author: item.author,
      sourceLabel: item.sourceLabel,
      tier: item.tier,
      publishedAt: item.publishedAt,
      discoveredAt: item.discoveredAt,
      excerpt: story.excerpt,
      thumbnail: item.thumbnail,
      platform: item.platform,
      related: story.related,
    });

  return (
    <article
      className={`feed-item${density === "compact" ? " is-compact" : ""}`}
      tabIndex={-1}
      data-content-id={item.id}
    >
      <div className="feed-meta">
        <span className={`tier-pill tier-${item.tier.toLowerCase()}`}>{tierShort[item.tier]}</span>
        <button
          type="button"
          className="feed-source-btn"
          onClick={() => onFilterSource(item.sourceId)}
          title={`仅看 ${item.sourceLabel}`}
        >
          {item.sourceLabel}
        </button>
        {item.author && item.author !== item.sourceLabel && (
          <span className="feed-author">{item.author}</span>
        )}
        <time dateTime={timestamp} title={formatExactTime(timestamp)}>
          {item.publishedAt ? "" : "发现于 "}
          {formatRelativeTime(timestamp)}
        </time>
        {story.sourceCount >= 2 && (
          <span className="surge-pill">{story.sourceCount} 源印证</span>
        )}
        {view === "hot" && (
          <span className="heat-pill">
            热度 {story.heat48h.toFixed(1)}
            {pct ? ` · ${pct}` : ""}
          </span>
        )}
        {view !== "latest" &&
          story.badges.map((badge) => (
            <span className={`signal-badge signal-${badge}`} key={badge}>
              {badgeLabels[badge]}
            </span>
          ))}
      </div>

      <div className="feed-body">
        <div className="feed-copy">
          <h2 className="feed-title">
            <button type="button" className="feed-title-btn" onClick={openDrawer}>
              {item.title}
            </button>
          </h2>
          {density === "comfortable" && story.excerpt && story.excerpt !== item.title && (
            <p className="feed-excerpt">{story.excerpt}</p>
          )}
        </div>
        {thumb && (
          <button
            type="button"
            className="feed-thumb-wrap"
            onClick={openDrawer}
            aria-label={`阅读：${item.title}`}
          >
            <img
              className="feed-thumb"
              src={thumb}
              alt=""
              width={116}
              height={72}
              loading="lazy"
              onError={(event) => {
                const parent = event.currentTarget.parentElement;
                if (parent) parent.style.display = "none";
              }}
            />
          </button>
        )}
      </div>

      {showMicrocharts && <StoryMicrocharts story={story} />}

      <div className="feed-actions">
        <button type="button" className="feed-action-btn" onClick={openDrawer}>
          <BookOpen size={13} /> 阅读详情
        </button>
        <button
          type="button"
          className={`feed-action-btn${saved ? " is-saved" : ""}`}
          onClick={() => onBookmark(item.id)}
        >
          <Bookmark size={13} /> {saved ? "已收藏" : "收藏"}
        </button>
        {href && (
          <a className="feed-action-btn" href={href} target="_blank" rel="noreferrer">
            原文 <ArrowUpRight size={13} />
          </a>
        )}
      </div>

      {story.relatedCount > 0 && (
        <details className="feed-related">
          <summary>
            {view === "digest" ? "当日进展" : "相关报道"}（{story.relatedCount}）
          </summary>
          <ul>
            {story.related.map((related) => {
              const relHref = safeHttpUrl(related.url);
              return (
                <li key={related.id}>
                  <span className={`tier-pill tier-${related.tier.toLowerCase()}`}>
                    {tierShort[related.tier]}
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      onOpen({
                        id: related.id,
                        title: related.title,
                        url: related.url,
                        author: related.author,
                        sourceLabel: related.sourceLabel,
                        tier: related.tier,
                        publishedAt: related.publishedAt,
                        discoveredAt: related.discoveredAt,
                        thumbnail: related.thumbnail,
                        platform: related.platform,
                      })
                    }
                  >
                    {related.title}
                  </button>
                  <small>{related.sourceLabel}</small>
                  {relHref && (
                    <a
                      href={relHref}
                      target="_blank"
                      rel="noreferrer"
                      className="subtle-ext"
                      aria-label={`打开原文：${related.title}`}
                    >
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </article>
  );
}

export function TimelineRow({
  item,
  source,
  density,
  saved,
  onOpen,
  onBookmark,
  onFilterSource,
}: {
  item: PublicContent;
  source?: PublicSourceSummary;
  density: "comfortable" | "compact";
  saved: boolean;
  onOpen: (preview: ReaderPreview) => void;
  onBookmark: (contentId: string) => void;
  onFilterSource: (sourceId: string) => void;
}) {
  const title = item.title?.trim() || item.text?.slice(0, 90)?.trim() || "无标题记录";
  const excerpt = item.text?.trim() && item.text.trim() !== title ? item.text.slice(0, 220) : null;
  const href = safeHttpUrl(item.url);
  const mediaThumb = item.media?.find((m) => m.previewUrl || m.type === "image");
  const thumb = safeHttpUrl(mediaThumb?.previewUrl ?? (mediaThumb?.type === "image" ? mediaThumb.url : null));
  const discoveredAt = item.observations[0]?.fetchedAt;
  const timestamp = item.publishedAt ?? discoveredAt;
  const sourceLabel = source?.label ?? item.platform;
  const tier = source?.tier;
  const author = item.author?.displayName ?? item.author?.handle ?? null;

  const openDrawer = () =>
    onOpen({
      id: item.id,
      title,
      url: item.url,
      author,
      sourceLabel,
      tier,
      publishedAt: item.publishedAt,
      discoveredAt,
      excerpt,
      thumbnail: thumb,
      platform: item.platform,
    });

  return (
    <article
      className={`feed-item${density === "compact" ? " is-compact" : ""}`}
      tabIndex={-1}
      data-content-id={item.id}
    >
      <div className="feed-meta">
        {tier && <span className={`tier-pill tier-${tier.toLowerCase()}`}>{tierShort[tier]}</span>}
        {source ? (
          <button
            type="button"
            className="feed-source-btn"
            onClick={() => onFilterSource(source.id)}
          >
            {sourceLabel}
          </button>
        ) : (
          <span className="feed-source-static">{sourceLabel}</span>
        )}
        {author && author !== sourceLabel && <span className="feed-author">{author}</span>}
        <time dateTime={timestamp} title={formatExactTime(timestamp)}>
          {formatRelativeTime(timestamp)}
        </time>
      </div>

      <div className="feed-body">
        <div className="feed-copy">
          <h2 className="feed-title">
            <button type="button" className="feed-title-btn" onClick={openDrawer}>
              {title}
            </button>
          </h2>
          {density === "comfortable" && excerpt && <p className="feed-excerpt">{excerpt}</p>}
        </div>
        {thumb && (
          <button
            type="button"
            className="feed-thumb-wrap"
            onClick={openDrawer}
            aria-label={`阅读：${title}`}
          >
            <img
              className="feed-thumb"
              src={thumb}
              alt=""
              width={116}
              height={72}
              loading="lazy"
              onError={(event) => {
                const parent = event.currentTarget.parentElement;
                if (parent) parent.style.display = "none";
              }}
            />
          </button>
        )}
      </div>

      <div className="feed-actions">
        <button type="button" className="feed-action-btn" onClick={openDrawer}>
          <BookOpen size={13} /> 阅读详情
        </button>
        <button
          type="button"
          className={`feed-action-btn${saved ? " is-saved" : ""}`}
          onClick={() => onBookmark(item.id)}
        >
          <Bookmark size={13} /> {saved ? "已收藏" : "收藏"}
        </button>
        {href && (
          <a className="feed-action-btn" href={href} target="_blank" rel="noreferrer">
            原文 <ArrowUpRight size={13} />
          </a>
        )}
      </div>
    </article>
  );
}
