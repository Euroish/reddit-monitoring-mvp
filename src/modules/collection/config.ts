import type { Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, PoolClient } from "pg";
import type { PublicContentKind } from "../../../packages/contracts/src/common";
import { SourceInput, SourcePreview, type SourceTarget } from "../../../packages/contracts/src/collection";
import { ContentProviderError, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";

export function collectionRequestRestriction(
  provider: string,
  platform: string,
  target: string,
  input: { limit: number; includeComments?: boolean; maxCommentsPerPost?: number },
): string | undefined {
  if (provider === "kaix" && target !== "post" &&
      input.limit * (input.includeComments ? (input.maxCommentsPerPost ?? 15) + 1 : 1) > 2000)
    return "Requested batch exceeds 2000 nodes";
  if (provider === "bluesky_appview" && (input.limit > 100 || input.includeComments))
    return "Bluesky supports at most 100 authored posts per request";
  if ((provider === "twitterapis" && input.includeComments) ||
      (provider === "scrapebadger" && (input.limit > 100 || input.includeComments)))
    return "X collection exceeds the provider page limit or requests comments";
  if (provider === "red_crawler" && (input.limit > (target === "post" ? 50 : 100) || (input.includeComments && target !== "post")))
    return "red_crawler supports one bounded search or post comment run per task";
  if (platform === "web" && (input.limit > 100 || input.includeComments))
    return "Web collection supports up to 100 articles per task";
}

export async function isCollectionBudgetDisabled(db: Pool | PoolClient, provider: string) {
  const { rows: [budget] } = await db.query<{ disabled: boolean }>(
    `SELECT NOT enabled OR LEAST(daily_requests, monthly_requests, daily_resources, monthly_resources)<=0 AS disabled
     FROM source_provider_budget WHERE provider=$1`, [provider],
  );
  return budget?.disabled ?? false;
}

export function validateFallback(providers: ContentProvider[], input: {
  primary: string; fallback: string; delivery: string; target: SourceTarget; kind: PublicContentKind;
}) {
  const expectedPrimary = input.fallback === "scrapebadger" ? "twitterapis" : "kaix";
  if (input.primary !== expectedPrimary || input.delivery !== "pull")
    fail(422, "Fallback is incompatible with the primary provider");
  const provider = providers.find(({ capability }) => capability.provider === input.fallback);
  if (!provider) fail(422, "Fallback provider not registered");
  provider.normalizeTarget(input.target, input.kind);
}

export function validateSource(providers: ContentProvider[], input: Static<typeof SourceInput>) {
  if (!input.label.trim()) fail(422, "Source label cannot be blank");
  const provider = providers.find(({ capability }) =>
    capability.provider === input.primaryProvider && capability.platform === input.platform);
  if ((input.deliveryMode === "push") !== (input.primaryProvider === "external_ingest"))
    fail(422, "Push sources require external_ingest");
  if (input.deliveryMode === "pull" && !provider) fail(422, "Unsupported provider for this platform");
  if (input.schedule?.enabled && input.deliveryMode !== "pull") fail(422, "Automatic scheduling requires a pull source");
  if (input.target.type === "feed" && input.target.list && input.primaryProvider !== "feed")
    fail(422, "List configuration requires the feed provider");
  const target = provider ? provider.normalizeTarget(input.target, input.contentKind) : input.target;
  if (input.fallbackProvider) validateFallback(providers, {
    primary: input.primaryProvider, fallback: input.fallbackProvider, delivery: input.deliveryMode, target, kind: input.contentKind,
  });
  return { target, provider };
}

export function sourcePreviewRoute(app: FastifyInstance, providers: ContentProvider[]) {
  let fetching = false;
  app.withTypeProvider<TypeBoxTypeProvider>().post("/v1/sources/preview", {
    schema: { body: SourceInput, response: { 200: SourcePreview } },
    config: { rateLimit: { max: 12, timeWindow: "1 minute" }, auth: { access: "admin", machineScope: "sources:write" } },
  }, async (request, reply) => {
    if (request.actor!.clientKind !== "browser" || request.actor!.role === "viewer")
      fail(403, "Administrator browser session required");
    const input = request.body;
    const { target, provider } = validateSource(providers, input);
    const providerEnabled = provider?.capability.enabled ?? input.primaryProvider === "external_ingest";
    if (!provider || !providerEnabled || !["feed", "newsnow"].includes(provider.capability.provider))
      return { mode: "validated" as const, target, providerEnabled, items: [], feeds: [] };
    if (fetching) {
      reply.header("Retry-After", "3");
      fail(429, "Another source preview is in progress");
    }
    fetching = true;
    try {
      const now = new Date().toISOString();
      const page = await provider.collectPage({
        source: { ...input, target, id: "00000000-0000-4000-8000-000000000000", state: "active",
          createdAt: now, updatedAt: now, revision: 1, fallbackProvider: input.fallbackProvider ?? null,
          tier: input.tier ?? "T2", ownerEntityId: input.ownerEntityId ?? null,
          sourceGroup: input.sourceGroup ?? null, tags: input.tags ?? [], locale: input.locale ?? null,
          fetchPolicy: input.fetchPolicy ?? {}, health: {}, coverage: "unknown" },
        from: "1970-01-01T00:00:00.000Z", to: now, limit: 20, checkpoint: null, preview: true,
      });
      return { mode: "fetched" as const, target, providerEnabled, feeds: page.discoveredFeeds ?? [],
        items: page.items.map(({ url, title, publishedAt, text }) => ({ url, title, publishedAt, summary: text?.slice(0, 280) ?? null })) };
    } catch (error) {
      if (error instanceof ContentProviderError) fail(error.retryable ? 503 : 422, error.message);
      throw error;
    } finally {
      fetching = false;
    }
  });
}
