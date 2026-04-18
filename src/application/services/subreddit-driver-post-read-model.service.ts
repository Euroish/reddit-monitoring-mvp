import type { Content } from "../../domain/entities/content";
import type { PostGrowthFact, PostGrowthAgeBucket } from "../../domain/entities/post-growth-fact";

export interface DriverPostReadModelItem {
  id: string;
  externalId: string;
  title: string;
  permalink: string;
  createdAtSource: string;
  url?: string;
  bodyText?: string;
  observedAt: string;
  ageBucket: PostGrowthAgeBucket;
  ageMinutes: number;
  score: number;
  comments: number;
  scoreVelocityPerHour: number;
  commentVelocityPerHour: number;
  velocityZScore: number;
  driverScore: number;
  labels: string[];
  matchedQueries?: string[];
  algorithmVersion: string;
  explainPayload: Record<string, unknown>;
}

export function buildSubredditDriverPostReadModel(args: {
  facts: PostGrowthFact[];
  contents: Content[];
  matchedQueriesByContentId?: ReadonlyMap<string, readonly string[]>;
}): DriverPostReadModelItem[] {
  if (args.facts.length === 0 || args.contents.length === 0) {
    return [];
  }

  const contentById = new Map(args.contents.map((content) => [content.id, content] as const));
  const rows: DriverPostReadModelItem[] = [];
  for (const fact of args.facts) {
    const content = contentById.get(fact.contentId);
    if (!content) {
      continue;
    }
    rows.push({
      id: content.id,
      externalId: content.externalId,
      title: content.title,
      permalink: content.permalink,
      createdAtSource: content.createdAtSource,
      url: content.url,
      bodyText: content.bodyText,
      observedAt: fact.observedAt,
      ageBucket: fact.ageBucket,
      ageMinutes: fact.ageMinutes,
      score: fact.score,
      comments: fact.comments,
      scoreVelocityPerHour: fact.scoreVelocityPerHour,
      commentVelocityPerHour: fact.commentVelocityPerHour,
      velocityZScore: fact.velocityZScore,
      driverScore: fact.driverScore,
      labels: buildDriverLabels(fact),
      matchedQueries: args.matchedQueriesByContentId?.get(fact.contentId)?.slice(),
      algorithmVersion: fact.algorithmVersion,
      explainPayload: fact.explainPayload,
    });
  }
  return rows;
}

function buildDriverLabels(fact: PostGrowthFact): string[] {
  const labels: string[] = [];

  if (fact.driverScore >= 90 || fact.velocityZScore >= 2.5) {
    labels.push("breakout");
  } else if (fact.driverScore >= 75 || fact.velocityZScore >= 1.5) {
    labels.push("surging");
  } else {
    labels.push("emerging");
  }

  if (fact.ageBucket === "1h") {
    labels.push("fresh");
  } else if (fact.ageBucket === "6h") {
    labels.push("sustained");
  } else {
    labels.push("mature");
  }

  return labels;
}
