import type { ConnectorRequestContext, RawEnvelope } from "../shared/connector.interface";
import type {
  NormalizedPostMetricPoint,
  NormalizedPostUpsert,
  NormalizedSubredditSnapshot,
  RedditAboutPayload,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export interface RedditMapper {
  toSubredditSnapshot(
    raw: RawEnvelope<RedditAboutPayload>,
    ctx: ConnectorRequestContext,
  ): NormalizedSubredditSnapshot;

  toPostUpserts(
    targetId: string,
    raw: RawEnvelope<RedditListingPayload<RedditPostData>>,
    ctx: ConnectorRequestContext,
  ): NormalizedPostUpsert[];

  toPostMetricPoints(
    raw: RawEnvelope<RedditListingPayload<RedditPostData>>,
    ctx: ConnectorRequestContext,
  ): NormalizedPostMetricPoint[];
}
