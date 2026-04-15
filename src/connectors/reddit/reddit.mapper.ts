import type { ConnectorRequestContext, RawEnvelope } from "../shared/connector.interface";
import type { RedditMapper } from "./reddit-mapper.interface";
import type {
  NormalizedPostMetricPoint,
  NormalizedPostUpsert,
  NormalizedSubredditSnapshot,
  RedditAboutPayload,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export class DefaultRedditMapper implements RedditMapper {
  public toSubredditSnapshot(
    raw: RawEnvelope<RedditAboutPayload>,
    ctx: ConnectorRequestContext,
  ): NormalizedSubredditSnapshot {
    const name = raw.payload.data.display_name;
    return {
      targetCanonicalName: `r/${name}`,
      snapshotAt: ctx.now,
      subscribers: raw.payload.data.subscribers,
      activeUsers: raw.payload.data.accounts_active,
    };
  }

  public toPostUpserts(
    targetId: string,
    raw: RawEnvelope<RedditListingPayload<RedditPostData>>,
    _ctx: ConnectorRequestContext,
  ): NormalizedPostUpsert[] {
    return raw.payload.data.children.map((child) => {
      const post = child.data;
      return {
        targetId,
        accountExternalId: post.author,
        externalId: post.name || `t3_${post.id}`,
        title: post.title,
        bodyText: post.selftext,
        url: post.url,
        permalink: post.permalink,
        createdAtSource: new Date(post.created_utc * 1000).toISOString(),
      };
    });
  }

  public toPostMetricPoints(
    raw: RawEnvelope<RedditListingPayload<RedditPostData>>,
    ctx: ConnectorRequestContext,
  ): NormalizedPostMetricPoint[] {
    return raw.payload.data.children.map((child) => {
      const post = child.data;
      return {
        externalId: post.name || `t3_${post.id}`,
        snapshotAt: ctx.now,
        score: post.score,
        numComments: post.num_comments,
        upvoteRatio: post.upvote_ratio,
      };
    });
  }
}

