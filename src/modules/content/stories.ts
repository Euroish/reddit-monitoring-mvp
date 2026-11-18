import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { StoryEvidence, StoryFeed, StoryQuery } from "../../../packages/contracts/src/content-stories";
import type { Actor, ContentAuthor } from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";
import { compileContentFilter, contentSourceTables } from "./search";
import { groupStories, type StoryTitle } from "./story-groups";

const hour = 3_600_000;
const tierWeight = { T1: 3, T1_5: 2, T2: 1 };
type Query = Static<typeof StoryQuery>;
type Row = {
  id: string; platform: StoryEvidence["platform"]; title: string; url: string | null;
  excerpt: string | null; author: ContentAuthor | null; language: string | null; links: string[];
  published_at: Date | null; event_at: Date; first_fetched_at: Date;
  source_id: string; label: string; tier: StoryEvidence["tier"]; participant: string; comparable: boolean;
};
type Entry = StoryTitle & {
  time: number;
  excerpt: string | null;
  english: boolean;
  evidence: StoryEvidence;
  discoveries: Row[];
};

function evidence(row: Row): StoryEvidence {
  return {
    id: row.id, platform: row.platform, title: row.title, url: row.url,
    author: row.author?.displayName ?? row.author?.handle ?? null,
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

function dateWindow(query: Query, now: number) {
  const view = query.view ?? "latest";
  if (query.date && view !== "digest") fail(422, "date is only available for the digest");
  // The publication cutoff is 08:00 Asia/Shanghai, currently 00:00 UTC.
  const midnight = Math.floor(now / (24 * hour)) * 24 * hour;
  const to = view !== "digest" ? now : query.date ? Date.parse(`${query.date}T00:00:00Z`) : midnight;
  if (to > now) fail(422, "The requested digest has not been published yet");
  return { view, from: to - (view === "digest" ? 24 : 48) * hour, to };
}

export async function contentStories(pool: Pool | PoolClient, actor: Actor, query: Query, now = Date.now()): Promise<StoryFeed> {
  const { view, from, to } = dateWindow(query, now);
  const toDate = new Date(to);
  const { discovery, values } = compileContentFilter(actor, { sourceId: query.sourceId }, undefined, {}, true);
  const start = `$${values.push(new Date(to - 54 * hour))}`;
  const end = `$${values.push(toDate)}`;
  const platform = query.platform ? `AND p.code=$${values.push(query.platform)}` : "";
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
      c.created_at_source AS published_at,COALESCE(c.created_at_source,d.first_fetched_at) AS event_at,d.first_fetched_at,
      cs.id AS source_id,cs.label,cs.tier,
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
    WHERE ${discovery} AND COALESCE(c.created_at_source,d.first_fetched_at) >= ${start}
      AND d.first_fetched_at < ${end} AND c.kind<>'comment' AND c.availability NOT IN ('removed','deleted')
      AND COALESCE(NULLIF(btrim(c.title),''),NULLIF(btrim(left(c.body_text,240)),'')) IS NOT NULL ${platform}
    ORDER BY event_at,c.id,cs.tier,cs.id`, values);

  const entries = new Map<string, Entry>();
  for (const row of rows) {
    const entry = entries.get(row.id);
    if (entry) {
      entry.discoveries.push(row);
      if (tierWeight[row.tier] > tierWeight[entry.evidence.tier]) entry.evidence = evidence(row);
    } else {
      entries.set(row.id, {
        id: row.id, title: row.title, url: row.url, links: row.links, time: row.event_at.getTime(),
        excerpt: row.excerpt, evidence: evidence(row), discoveries: [row],
        english: row.language ? /^en(?:-|$)/i.test(row.language) : !/\p{Script=Han}/u.test(row.title) && /[a-z]/i.test(row.title),
      });
    }
  }
  const ranked = groupStories([...entries.values()]).flatMap(group => {
    const active = group.filter(item => item.discoveries.some(row => row.event_at.getTime() >= to - 48 * hour));
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
    const updatedAt = new Date(recent.reduce((latest, item) => Math.max(latest, item.time), from)).toISOString();
    const story: StoryFeed["items"][number] = {
      storyKey: group[0].id, representative: representative.evidence, excerpt: representative.excerpt,
      related: related.slice(0, 6).map(item => item.evidence), relatedCount: related.length,
      sourceCount: current.count, heat48h: current.heat, change6h: change, trend, badges: badge ? [badge] : [], updatedAt,
    };
    return [story];
  });
  ranked.sort((a, b) => (view === "latest" ? 0 : b.heat48h - a.heat48h) ||
    b.updatedAt.localeCompare(a.updatedAt) || a.storyKey.localeCompare(b.storyKey));
  return {
    view, from: new Date(from).toISOString(), to: toDate.toISOString(),
    items: ranked.slice(0, query.limit ?? 20), coverage: "stored_sample",
  };
}
