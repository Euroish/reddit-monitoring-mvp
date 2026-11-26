import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { StoryEvidence, StoryFeed, StoryQuery } from "../../../packages/contracts/src/content-stories";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentAuthor } from "../../../packages/contracts/src/content";
import { fail } from "../../shared/errors";
import { cleanTextForAnalysis, stemEnglishToken, tokenizeText } from "../../shared/text/analysis";
import { detectLanguage } from "../../shared/text/language";
import { compileContentFilter, contentSourceTables, type ContentVisibilityResolver } from "./search";
import { groupStories, type StoryTitle } from "./story-groups";

const hour = 3_600_000;
const MAX_STORED_STORIES = 600;
const MAX_STORY_DISCOVERIES = 10_000;
const tierWeight = { T1: 3, T1_5: 2, T2: 1 };
type Query = Static<typeof StoryQuery>;
type Row = {
  id: string; platform: StoryEvidence["platform"]; title: string; url: string | null;
  excerpt: string | null; author: ContentAuthor | null; language: string | null; links: string[];
  thumbnail: string | null; published_at: Date | null; event_at: Date; first_fetched_at: Date;
  source_id: string; label: string; source_group: string; tier: StoryEvidence["tier"]; participant: string; comparable: boolean;
};
export interface StoryInsightMeta {
  storyKey: string;
  sourceGroup: string;
  language: string;
  eventTimeMs: number;
  participatingSourceIds: string[];
  textForAnalysis: string;
  tokenSet: Set<string>;
  stemSet?: Set<string>;
  hasComparableSource: boolean;
}
export interface StoryDrilldownFilter {
  term?: string;
  topicId?: string;
  topicStoryKeys?: Set<string>;
  bucketFrom?: number;
  bucketTo?: number;
  insightTier?: StoryEvidence["tier"];
  insightSourceGroup?: string;
  insightLanguage?: string;
  insightSourceId?: string;
}
type Entry = StoryTitle & {
  time: number;
  excerpt: string | null;
  english: boolean;
  sourceGroup: string;
  normalizedLang: string;
  evidence: StoryEvidence;
  discoveries: Row[];
};

function evidence(row: Row): StoryEvidence {
  return {
    id: row.id, platform: row.platform, title: row.title, url: row.url,
    author: row.author?.displayName ?? row.author?.handle ?? null,
    thumbnail: row.thumbnail ?? null,
    sourceId: row.source_id, sourceLabel: row.label, tier: row.tier,
    publishedAt: row.published_at?.toISOString() ?? null, discoveredAt: row.first_fetched_at.toISOString(),
  };
}

function participantHeat(group: Entry[], at: number, comparable: boolean) {
  const contributions = new Map<string, number>();
  for (const item of group) {
    for (const row of item.discoveries) {
      if (comparable && !row.comparable) continue;
      const age = (at - row.event_at.getTime()) / hour;
      if (age <= 0 || age > 48 || row.first_fetched_at.getTime() >= at) continue;
      const score = tierWeight[row.tier] * 0.5 ** (age / 24);
      contributions.set(row.participant, Math.max(contributions.get(row.participant) ?? 0, score));
    }
  }
  return { count: contributions.size, heat: [...contributions.values()].reduce((sum, score) => sum + score, 0) };
}

function storyMicrocharts(group: Entry[], to: number, activeFrom: number) {
  const sparkFrom = to - 48 * hour;
  const bucketDuration = 6 * hour;
  const sources = { T1: new Set<string>(), T1_5: new Set<string>(), T2: new Set<string>() };
  const buckets = Array.from({ length: 8 }, () => new Map<string, number>());
  for (const item of group) {
    for (const row of item.discoveries) {
      const time = row.event_at.getTime();
      if (time < activeFrom || time >= to) continue;
      sources[row.tier].add(row.source_id);
      if (time < sparkFrom) continue;
      const index = Math.floor((time - sparkFrom) / bucketDuration);
      const bucketEnd = sparkFrom + (index + 1) * bucketDuration;
      const score = tierWeight[row.tier] * 0.5 ** ((bucketEnd - time) / (24 * hour));
      const bucket = buckets[index];
      bucket.set(row.participant, Math.max(bucket.get(row.participant) ?? 0, score));
    }
  }
  return {
    tierBreakdown: { T1: sources.T1.size, T1_5: sources.T1_5.size, T2: sources.T2.size },
    sparkline48h: buckets.map(bucket => [...bucket.values()].reduce((sum, score) => sum + score, 0)),
  };
}

function dateWindow(query: Query, now: number) {
  const view = query.view ?? "latest";
  if (query.date && view !== "digest") fail(422, "date is only available for the digest");
  // The publication cutoff is 08:00 Asia/Shanghai, currently 00:00 UTC.
  const midnight = Math.floor(now / (24 * hour)) * 24 * hour;
  const to = view !== "digest" ? now : query.date ? Date.parse(`${query.date}T00:00:00Z`) : midnight;
  if (to > now) fail(422, "The requested digest has not been published yet");
  const spanHours = view === "latest" ? 168 : view === "digest" ? 24 : 48;
  const lookbackHours = view === "latest" ? 174 : 54;
  return { view, from: to - spanHours * hour, lookback: to - lookbackHours * hour, to };
}

interface SourceWaveQueue {
  sid: string;
  indices: number[];
  head: number;
}

class SourcePosHeap {
  private readonly items: SourceWaveQueue[] = [];

  get size() {
    return this.items.length;
  }

  push(entry: SourceWaveQueue) {
    this.items.push(entry);
    let idx = this.items.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.pos(parent) <= this.pos(idx)) break;
      [this.items[parent], this.items[idx]] = [this.items[idx], this.items[parent]];
      idx = parent;
    }
  }

  pop(): SourceWaveQueue | undefined {
    if (!this.items.length) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      this.items[0] = last;
      this.sink(0);
    }
    return top;
  }

  private pos(i: number) {
    return this.items[i].indices[this.items[i].head];
  }

  private sink(i: number) {
    const n = this.items.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = left + 1;
      if (left < n && this.pos(left) < this.pos(smallest)) smallest = left;
      if (right < n && this.pos(right) < this.pos(smallest)) smallest = right;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

function orderIntoWaves(items: StoryFeed["items"], maxPerRun: number) {
  const seen = new Map<string, number>();
  const waves = new Map<number, StoryFeed["items"]>();
  for (const item of items) {
    const sid = item.representative.sourceId;
    const count = seen.get(sid) ?? 0;
    seen.set(sid, count + 1);
    const wave = Math.floor(count / (item.representative.tier === "T2" ? 1 : maxPerRun));
    const bucket = waves.get(wave);
    if (bucket) bucket.push(item);
    else waves.set(wave, [item]);
  }
  return [...waves.keys()].sort((a, b) => a - b).flatMap((w) => waves.get(w)!);
}

function buildSourceQueues(pending: StoryFeed["items"]) {
  const bySource = new Map<string, SourceWaveQueue>();
  for (let i = 0; i < pending.length; i++) {
    const sid = pending[i].representative.sourceId;
    let queue = bySource.get(sid);
    if (!queue) {
      queue = { sid, indices: [], head: 0 };
      bySource.set(sid, queue);
    }
    queue.indices.push(i);
  }
  const heap = new SourcePosHeap();
  for (const q of bySource.values()) heap.push(q);
  return { bySource, heap };
}

function pickEarliestParked(parked: Set<SourceWaveQueue>) {
  let chosen: SourceWaveQueue | undefined;
  for (const candidate of parked) {
    if (!chosen || candidate.indices[candidate.head] < chosen.indices[chosen.head]) chosen = candidate;
  }
  if (chosen) parked.delete(chosen);
  return chosen;
}

export function diversifyStories(
  items: StoryFeed["items"],
  maxPerRun = 2,
  windowSize = 12,
): StoryFeed["items"] {
  if (items.length <= maxPerRun) return items;
  const pending = orderIntoWaves(items, maxPerRun);
  const { bySource, heap } = buildSourceQueues(pending);
  const parked = new Set<SourceWaveQueue>();
  const recent = new Map<string, number>();
  const result: StoryFeed["items"] = [];

  for (let step = 0; step < pending.length; step++) {
    let chosen: SourceWaveQueue | undefined;
    while (heap.size > 0) {
      const candidate = heap.pop()!;
      if ((recent.get(candidate.sid) ?? 0) < maxPerRun) {
        chosen = candidate;
        break;
      }
      parked.add(candidate);
    }
    chosen ??= pickEarliestParked(parked);
    if (!chosen) break;
    result.push(pending[chosen.indices[chosen.head++]]);
    recent.set(chosen.sid, (recent.get(chosen.sid) ?? 0) + 1);
    if (result.length >= windowSize) {
      const expiredSid = result[result.length - windowSize].representative.sourceId;
      const nextCount = (recent.get(expiredSid) ?? 0) - 1;
      if (nextCount <= 0) recent.delete(expiredSid);
      else recent.set(expiredSid, nextCount);
      const expiredQueue = bySource.get(expiredSid)!;
      if (nextCount < maxPerRun && expiredSid !== chosen.sid && parked.delete(expiredQueue) && expiredQueue.head < expiredQueue.indices.length) {
        heap.push(expiredQueue);
      }
    }
    if (chosen.head < chosen.indices.length) {
      if ((recent.get(chosen.sid) ?? 0) >= maxPerRun) parked.add(chosen);
      else heap.push(chosen);
    }
  }
  return result;
}

export async function readStoryWindow(
  pool: Pool | PoolClient,
  actor: Actor,
  query: Query,
  now = Date.now(),
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const { view, from, lookback, to } = dateWindow(query, now);
  const toDate = new Date(to);
  const { discovery, values } = compileContentFilter(
    actor,
    { sourceId: query.sourceId, sourceGroup: query.sourceGroup, tier: query.tier },
    undefined,
    {},
    true,
    resolveContentVisibility?.(actor, { publicOnly: true }),
  );
  const start = `$${values.push(new Date(lookback))}`;
  const end = `$${values.push(toDate)}`;
  const platform = query.platform ? `AND p.code=$${values.push(query.platform)}` : "";
  const scopeSql = query.channelScope === "info"
    ? "AND p.code='web'"
    : query.channelScope === "social"
      ? "AND p.code=ANY(ARRAY['reddit','x','bluesky']::text[])"
      : "";
  const language = query.language ? `AND c.language=$${values.push(query.language)}` : "";
  const hideTrends = query.channelScope === "social"
    ? query.includeTrends === false
    : !query.sourceGroup && !query.sourceId && !query.includeTrends && view !== "digest";
  const excludeTrends = hideTrends ? "AND COALESCE(cs.source_group, '') <> 'social-trends'" : "";
  const activeOnly = query.sourceId ? "" : "AND cs.state='active'";
  const { rows } = await pool.query<Row>(`
    WITH candidates AS MATERIALIZED (
      SELECT id FROM content WHERE created_at_source >= ${start} AND created_at_source < ${end}
      UNION
      SELECT undated.id FROM content_discovery recent JOIN content undated ON undated.id=recent.content_id
      WHERE recent.first_fetched_at >= ${start} AND recent.first_fetched_at < ${end} AND undated.created_at_source IS NULL
    )
    SELECT c.id,p.code AS platform,COALESCE(NULLIF(btrim(c.title),''),left(c.body_text,240)) AS title,
      COALESCE(c.permalink,c.url) AS url,left(c.body_text,300) AS excerpt,c.content_author AS author,c.language,
      ARRAY(SELECT m->>'url' FROM jsonb_array_elements(c.content_media) m WHERE m->>'type'='link' LIMIT 3) AS links,
      (SELECT m->>'url' FROM jsonb_array_elements(c.content_media) m WHERE m->>'type'='image' LIMIT 1) AS thumbnail,
      c.created_at_source AS published_at,COALESCE(c.created_at_source,d.first_fetched_at) AS event_at,d.first_fetched_at,
      cs.id AS source_id,cs.label,COALESCE(cs.source_group, '') AS source_group,cs.tier,
      COALESCE('owner:'||cs.owner_entity_id,
        CASE
          WHEN p.code='web' AND c.platform_details->>'publisher' IN ('www.youtube.com','youtube.com') AND cs.target->>'url' IS NOT NULL
            THEN cs.target->>'url'
          WHEN p.code='web' THEN regexp_replace(lower(c.platform_details->>'publisher'), '^www\\.', '')
          ELSE p.code||':'||COALESCE(c.content_author->>'externalId',lower(c.content_author->>'handle'))
        END, 'source:'||cs.id) AS participant,
      (cs.state='active' AND cs.created_at <= ${end}::timestamptz - interval '6 hours'
        AND (NOT (cs.schedule @> '{"enabled":true}') OR COALESCE(cs.last_checked_at >= ${end}::timestamptz -
          make_interval(secs => GREATEST(21600,2*COALESCE((cs.schedule->>'intervalSeconds')::int,(cs.schedule->>'cadenceSeconds')::int,3600))),false))) AS comparable
    FROM candidates k JOIN ${contentSourceTables} ON c.id=k.id
    JOIN content_discovery d ON d.content_id=c.id JOIN collection_source cs ON cs.id=d.collection_source_id
    WHERE ${discovery} ${excludeTrends} ${activeOnly} AND COALESCE(c.created_at_source,d.first_fetched_at) >= ${start}
      AND d.first_fetched_at < ${end} AND c.kind<>'comment' AND c.availability NOT IN ('removed','deleted')
      AND COALESCE(NULLIF(btrim(c.title),''),NULLIF(btrim(left(c.body_text,240)),'')) IS NOT NULL ${platform} ${scopeSql} ${language}
    ORDER BY event_at,c.id,cs.tier,cs.id LIMIT $${values.push(MAX_STORY_DISCOVERIES + 1)}`, values);
  if (rows.length > MAX_STORY_DISCOVERIES)
    fail(503, "Story window is too large to rank; narrow by source or channel");

  const entries = new Map<string, Entry>();
  for (const row of rows) {
    const entry = entries.get(row.id);
    if (entry) {
      entry.discoveries.push(row);
      if (tierWeight[row.tier] > tierWeight[entry.evidence.tier]) {
        entry.evidence = evidence(row);
        entry.sourceGroup = row.source_group;
      }
    } else {
      const detected = row.language?.toLowerCase().split("-")[0]
        || detectLanguage(row.title, row.excerpt)
        || ( !/\p{Script=Han}/u.test(row.title) && /[a-z]/i.test(row.title) ? "en" : "other");
      entries.set(row.id, {
        id: row.id, title: row.title, url: row.url, links: row.links, time: row.event_at.getTime(),
        excerpt: row.excerpt, sourceGroup: row.source_group, normalizedLang: detected,
        evidence: evidence(row), discoveries: [row],
        english: detected === "en",
      });
    }
  }
  const activeFrom = Math.min(from, to - 48 * hour);
  const metaByStoryKey = new Map<string, StoryInsightMeta>();
  const ranked = groupStories([...entries.values()]).flatMap(group => {
    const active = group.filter(item => item.discoveries.some(row => row.event_at.getTime() >= activeFrom));
    const recent = active.filter(item => item.time >= from);
    if (!recent.length) return [];
    active.sort((a, b) => tierWeight[b.evidence.tier] - tierWeight[a.evidence.tier]
      || (a.evidence.tier !== "T2" ? Number(b.english) - Number(a.english) : 0)
      || Number(!!b.excerpt) - Number(!!a.excerpt) || a.time - b.time || a.id.localeCompare(b.id));
    const representative = active[0];
    const current = participantHeat(active, to, false);
    const comparable = participantHeat(active, to, true);
    const prior = participantHeat(group, to - 6 * hour, true);
    const change = prior.heat ? comparable.heat / prior.heat - 1 : null;
    const trend = !comparable.count && !prior.count ? "unknown" : change === null ? "new" : change >= 0.1 ? "up" : change <= -0.1 ? "down" : "flat";
    const badge = trend === "new" ? "new" : trend === "up" ? change! >= 0.5 && comparable.count >= 2 ? "surge" : "rising" : null;
    const related = active.filter(item => item !== representative && (view !== "digest" || item.time >= from))
      .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
    const latestRecentMs = recent.reduce((latest, item) => Math.max(latest, item.time), from);
    const updatedAt = new Date(latestRecentMs).toISOString();
    const activeSources = current.count || new Set(
      active.flatMap(item => item.discoveries
        .filter(row => row.event_at.getTime() >= activeFrom && row.event_at.getTime() < to)
        .map(row => row.participant)),
    ).size;
    const story: StoryFeed["items"][number] = {
      storyKey: group[0].id, representative: representative.evidence, excerpt: representative.excerpt,
      related: related.slice(0, 6).map(item => item.evidence), relatedCount: related.length,
      ...storyMicrocharts(active, to, activeFrom),
      sourceCount: activeSources, heat48h: current.heat, change6h: change, trend, badges: badge ? [badge] : [], updatedAt,
    };
    const combinedRaw = [representative.title, representative.excerpt ?? ""]
      .filter(Boolean)
      .join(" ");
    const cleanText = cleanTextForAnalysis(combinedRaw, true);
    const tokens = tokenizeText(cleanText, { preserveTechPhrases: true, maxTokensPerDoc: 120 });
    metaByStoryKey.set(story.storyKey, {
      storyKey: story.storyKey,
      sourceGroup: representative.sourceGroup,
      language: representative.normalizedLang,
      eventTimeMs: latestRecentMs,
      participatingSourceIds: [...new Set(active.flatMap((it) => it.discoveries.map((d) => d.source_id)))],
      textForAnalysis: cleanText,
      tokenSet: new Set(tokens),
      stemSet: new Set(tokens.map(stemEnglishToken)),
      hasComparableSource: active.some((it) => it.discoveries.some((d) => d.comparable)),
    });
    return [story];
  });
  const totalRankedCount = ranked.length;
  const latestFirst = (a: StoryFeed["items"][number], b: StoryFeed["items"][number]) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.storyKey.localeCompare(b.storyKey);
  const latest = view === "digest" ? [] : [...ranked].sort(latestFirst).slice(0, MAX_STORED_STORIES);
  const hottest = ranked.sort((a, b) => b.heat48h - a.heat48h || latestFirst(a, b)).slice(0, MAX_STORED_STORIES);
  return {
    view,
    from: new Date(from).toISOString(),
    to: toDate.toISOString(),
    fromMs: from,
    toMs: to,
    latest,
    hottest,
    totalRankedCount,
    metaByStoryKey,
  };
}

export function selectStoryFeed(
  window: Awaited<ReturnType<typeof readStoryWindow>>,
  view: StoryFeed["view"],
  limit: number,
  offset = 0,
  diverse = true,
  drilldown?: StoryDrilldownFilter,
): StoryFeed {
  const list = view === "latest" ? window.latest : window.hottest;
  const filtered = !drilldown
    ? list
    : list.filter((story) => {
        const meta = window.metaByStoryKey?.get(story.storyKey);
        if (drilldown.insightTier && story.representative.tier !== drilldown.insightTier) return false;
        if (drilldown.insightSourceId && story.representative.sourceId !== drilldown.insightSourceId) return false;
        if (drilldown.insightSourceGroup !== undefined && meta?.sourceGroup !== drilldown.insightSourceGroup) return false;
        if (drilldown.insightLanguage && meta?.language !== drilldown.insightLanguage) return false;
        if (drilldown.bucketFrom !== undefined && drilldown.bucketTo !== undefined) {
          const ts = meta?.eventTimeMs ?? Date.parse(story.updatedAt);
          if (ts < drilldown.bucketFrom || ts >= drilldown.bucketTo) return false;
        }
        if (drilldown.topicId && drilldown.topicStoryKeys && !drilldown.topicStoryKeys.has(story.storyKey)) {
          return false;
        }
        if (drilldown.term) {
          const needle = drilldown.term.trim().toLowerCase();
          const needleAlias = needle.replace(/[\s-]+/g, "_");
          const needleStem = stemEnglishToken(needle);
          if (meta) {
            if (
              !meta.tokenSet.has(needle) &&
              !meta.tokenSet.has(needleAlias) &&
              !meta.stemSet?.has(needleStem) &&
              !meta.textForAnalysis.toLowerCase().includes(needle)
            ) {
              return false;
            }
          } else {
            const hay = `${story.representative.title} ${story.excerpt ?? ""}`.toLowerCase();
            if (!hay.includes(needle)) return false;
          }
        }
        return true;
      });
  const ordered = diverse ? diversifyStories(filtered) : filtered;
  const items = ordered.slice(offset, offset + limit);
  const totalCount = ordered.length;
  return {
    view,
    from: window.from,
    to: window.to,
    items,
    totalCount,
    nextOffset: offset + items.length < totalCount ? offset + items.length : null,
    coverage: "stored_sample",
  };
}
