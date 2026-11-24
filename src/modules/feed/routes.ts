import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import {
  FeedEventBatchBody, FeedHotQuery, FeedHotResponse, FeedPreferences,
  FeedPreferencesPatch, FeedStreamQuery, FeedStreamResponse,
} from "../../../packages/contracts/src/feed";
import type { ContentVisibilityResolver } from "../content/index";
import { fail } from "../../shared/errors";
import {
  getFeedPreferences, isAuthenticatedUser, readFeedHotBoard, readFeedStream,
  recordFeedEvents, resetFeedProfile, updateFeedPreferences,
} from "./sql";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseExcludeIds(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 120) fail(422, "excludeIds accepts at most 120 UUIDs");
  for (const id of parts) if (!UUID_RE.test(id)) fail(422, "Invalid UUID in excludeIds");
  return parts;
}

export async function feedRoutes(
  app: FastifyInstance,
  pool: Pool,
  resolveContentVisibility?: ContentVisibilityResolver,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const publicReadAuth = { auth: { access: "public_read" as const, machineScope: "read" as const } };
  const authRead = { auth: { access: "authenticated" as const } };
  const viewerWrite = { auth: { access: "viewer_write" as const } };

  api.get("/v1/feed/stream", { config: publicReadAuth, schema: { querystring: FeedStreamQuery, response: { 200: FeedStreamResponse } } },
    (request) => readFeedStream(pool, request.actor!, request.query, parseExcludeIds(request.query.excludeIds), resolveContentVisibility));
  api.get("/v1/feed/hot", { config: publicReadAuth, schema: { querystring: FeedHotQuery, response: { 200: FeedHotResponse } } },
    (request) => readFeedHotBoard(pool, request.actor!, request.query, resolveContentVisibility));
  api.post("/v1/feed/events", { config: viewerWrite, schema: { body: FeedEventBatchBody } }, (request) => {
    if (!isAuthenticatedUser(request.actor!)) fail(401, "Sign in to record feed feedback");
    return recordFeedEvents(pool, request.actor!, request.body, resolveContentVisibility);
  });
  api.get("/v1/feed/preferences", { config: authRead, schema: { response: { 200: FeedPreferences } } },
    (request) => getFeedPreferences(pool, request.actor!));
  api.patch("/v1/feed/preferences", { config: viewerWrite, schema: { body: FeedPreferencesPatch, response: { 200: FeedPreferences } } },
    (request) => updateFeedPreferences(pool, request.actor!, request.body));
  api.post("/v1/feed/preferences/reset", { config: viewerWrite },
    (request) => resetFeedProfile(pool, request.actor!));
}
