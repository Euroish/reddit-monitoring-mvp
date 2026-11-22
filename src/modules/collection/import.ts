import { randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { load } from "cheerio";
import {
  SourceImportInput,
  SourceInput,
  type SourceTarget,
} from "../../../packages/contracts/src/collection";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { validateSource } from "./config";
import { audit } from "./sql";

type SourceItem = Static<typeof SourceInput>;
type OpmlDefaults = Extract<Static<typeof SourceImportInput>, { format: "opml" }>["defaults"];

function normalizeSourceGroup(raw: string | undefined): string | null {
  if (!raw) return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48);
  return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug) ? slug : null;
}

function parseOpmlSources(opml: string, defaults: OpmlDefaults): SourceItem[] {
  const $ = load(opml, { xmlMode: true });
  const outlines = $("outline")
    .toArray()
    .filter((el) => $(el).attr("xmlUrl") !== undefined || $(el).attr("xmlurl") !== undefined);
  if (outlines.length > 200) fail(422, "OPML import supports at most 200 feeds");
  return outlines.map((el) => {
    const xmlUrl = ($(el).attr("xmlUrl") ?? $(el).attr("xmlurl") ?? "").trim();
    let host = "feed";
    try {
      host = new URL(xmlUrl).hostname || "feed";
    } catch {
      // Validation below records malformed URL errors per entry.
    }
    const rawLabel = $(el).attr("title")?.trim() || $(el).attr("text")?.trim() || host;
    const category = $(el)
      .parents("outline")
      .toArray()
      .map((parent) => $(parent).attr("title")?.trim() || $(parent).attr("text")?.trim())
      .find(Boolean);
    const sourceGroup = normalizeSourceGroup(category) ?? defaults?.sourceGroup ?? null;
    return {
      platform: "web",
      primaryProvider: "feed",
      contentKind: "article",
      deliveryMode: "pull",
      label: rawLabel.slice(0, 100),
      target: { type: "feed", url: xmlUrl },
      ...(sourceGroup !== null ? { sourceGroup } : {}),
      ...(defaults?.tier ? { tier: defaults.tier } : {}),
      ...(defaults?.locale !== undefined ? { locale: defaults.locale } : {}),
      ...(defaults?.schedule ? { schedule: defaults.schedule } : {}),
      ...(defaults?.fetchPolicy ? { fetchPolicy: defaults.fetchPolicy } : {}),
    };
  });
}

export async function sourceImportRoute(
  app: FastifyInstance,
  pool: Pool,
  providers: ContentProvider[],
) {
  app.withTypeProvider<TypeBoxTypeProvider>().post(
    "/v1/sources/import",
    {
      schema: { body: SourceImportInput },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" }, auth: { access: "admin", machineScope: "sources:write" } },
    },
    async (request) => {
      if (request.actor!.clientKind !== "browser" || request.actor!.role === "viewer")
        fail(403, "Administrator browser session required");
      const candidates =
        request.body.format === "json"
          ? request.body.sources
          : parseOpmlSources(request.body.opml, request.body.defaults);
      const valid: Array<{ item: SourceItem; target: SourceTarget }> = [];
      const errors: Array<{ index: number; label: string; error: string }> = [];
      for (let index = 0; index < candidates.length; index++) {
        const item = candidates[index];
        try {
          if (item.target.type === "feed") {
            if (!item.target.url || item.target.url.length > 2000)
              fail(422, "Feed URL must be 1 to 2000 characters");
            new URL(item.target.url);
          }
          const { target } = validateSource(providers, item);
          valid.push({ item, target });
        } catch (error) {
          errors.push({
            index,
            label: item.label,
            error: error instanceof Error ? error.message : "Invalid source",
          });
        }
      }
      if (!valid.length) return { created: 0, skipped: 0, errors };
      const payload = valid.map(({ item, target }) =>
        JSON.stringify({
          id: randomUUID(),
          platform: item.platform,
          primaryProvider: item.primaryProvider,
          label: item.label,
          target,
          contentKind: item.contentKind,
          deliveryMode: item.deliveryMode,
          fallbackProvider: item.fallbackProvider ?? null,
          schedule: item.schedule ?? { enabled: false },
          tier: item.tier ?? "T2",
          ownerEntityId: item.ownerEntityId ?? null,
          sourceGroup: item.sourceGroup ?? null,
          tags: item.tags ?? [],
          locale: item.locale ?? null,
          fetchPolicy: item.fetchPolicy ?? {},
        }),
      );
      const created = await transaction(pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO collection_source(
            id,platform_id,primary_provider,label,target,content_kind,delivery_mode,
            fallback_provider,created_at,updated_at,schedule,next_due_at,tier,
            owner_entity_id,source_group,tags,locale,fetch_policy
          )
          SELECT (v->>'id')::uuid,s.id,v->>'primaryProvider',v->>'label',v->'target',
            v->>'contentKind',v->>'deliveryMode',v->>'fallbackProvider',NOW(),NOW(),
            v->'schedule',CASE WHEN (v->'schedule') @> '{"enabled":true}' THEN NOW() END,
            v->>'tier',v->>'ownerEntityId',v->>'sourceGroup',
            ARRAY(SELECT jsonb_array_elements_text(v->'tags')),v->>'locale',v->'fetchPolicy'
          FROM UNNEST($1::jsonb[]) AS input(v)
          JOIN source s ON s.code=v->>'platform'
          ON CONFLICT (platform_id,primary_provider,content_kind,target) DO NOTHING
          RETURNING id`,
          [payload],
        );
        const count = inserted.rowCount ?? 0;
        if (count > 0) await audit(client, request.actor!, "sources.import");
        return count;
      });
      return { created, skipped: valid.length - created, errors };
    },
  );
}
