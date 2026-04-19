import type { RedditConnector } from "../connectors/reddit/reddit-connector.interface";
import type { RedditScraplingProfile } from "../connectors/reddit/reddit-scrapling.connector";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type { ProviderHealthWindowRepository } from "../domain/repositories/provider-health-window-repository";
import type { Phase1CrawlMode, Phase1RunMode } from "./reddit-phase1-runtime";
import {
  resolveRedditTargetExecutionRoute,
  type RedditProviderRoutingPolicyContext,
  type RedditTargetExecutionRoute,
} from "./reddit-provider-routing-policy";

export interface RedditExecutionStrategy extends RedditTargetExecutionRoute {
  connector: RedditConnector;
}

export function createRedditFetchExecutionEngine(args: {
  mode: Phase1RunMode;
  createConnector: (
    mode: Phase1RunMode,
    crawlMode?: Phase1CrawlMode,
    providerOverride?: string,
    scraplingProfileOverride?: RedditScraplingProfile,
  ) => RedditConnector;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  policyContext: RedditProviderRoutingPolicyContext;
}) {
  const connectorCache = new Map<string, RedditConnector>();

  return {
    resolveStrategy: async (input: {
      targetId: string;
      canonicalName: string;
      crawlMode: Phase1CrawlMode;
      nowIso: string;
      defaultProviderHint?: string;
    }): Promise<RedditExecutionStrategy> => {
      const route = await resolveRedditTargetExecutionRoute({
        ...input,
        providerHealthWindowRepository: args.providerHealthWindowRepository,
        crawlCursorRepository: args.crawlCursorRepository,
        policyContext: args.policyContext,
      });
      const cacheKey = [
        input.crawlMode,
        route.selectedProvider,
        route.scraplingProfile ?? "none",
      ].join(":");
      let connector = connectorCache.get(cacheKey);
      if (!connector) {
        connector = args.createConnector(
          args.mode,
          input.crawlMode,
          route.selectedProvider,
          route.scraplingProfile ?? undefined,
        );
        connectorCache.set(cacheKey, connector);
      }
      return {
        ...route,
        connector,
      };
    },
  };
}
