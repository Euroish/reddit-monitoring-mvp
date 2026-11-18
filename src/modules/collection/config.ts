import type { Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { SourceInput, SourcePreview, type PublicContentKind, type SourceTarget } from "../../../packages/contracts/src/source-content";
import { ContentProviderError, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../storage/db";

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
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
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
          createdAt: now, updatedAt: now, revision: 1, fallbackProvider: input.fallbackProvider ?? null, coverage: "unknown" },
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
