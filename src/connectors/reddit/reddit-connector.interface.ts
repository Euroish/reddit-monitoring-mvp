import type {
  ConnectorPage,
  ConnectorRequestContext,
  SourceConnector,
} from "../shared/connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export interface RedditConnector
  extends SourceConnector<RedditCollectSubredditPostsArgs, RedditListingPayload<RedditPostData>> {
  collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>>;

  collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>>;
}

