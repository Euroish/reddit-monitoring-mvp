import { randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { SourceInput } from "../../../packages/contracts/src/collection";
import type { MonitorConfigValue, MonitorKindValue } from "../../../packages/contracts/src/intelligence";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";
import { DAILY_SOCIAL_ITEM_CEILING, ensureManagedSource, getProviderDailyUsage } from "../collection/index";
import { packXAccountBatches } from "./metrics";



interface ProvisionSpec {
  role: "primary" | "competitor" | "bundle_member";
  targetLabel: string;
  sourceInput: Static<typeof SourceInput>;
}

interface TargetRow {
  targetKind: "keyword" | "competitor_keyword" | "author" | "subreddit";
  targetValue: string;
  platform: "reddit" | "x";
}

function buildSchedule(intervalHours: number) {
  return { enabled: true, cadenceSeconds: Math.min(43200, Math.max(120, intervalHours * 3600)), pageSize: 50, maxPages: 1 };
}

function buildKeywordSpecs(
  config: MonitorConfigValue,
  schedule: ReturnType<typeof buildSchedule>,
): { specs: ProvisionSpec[]; targets: TargetRow[] } {
  const specs: ProvisionSpec[] = [];
  const targets: TargetRow[] = [];
  const primary = (config.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const comp = (config.competitorKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (!primary.length) fail(422, "Keyword monitor requires at least one keyword");

  const entries: Array<{ kw: string; role: "primary" | "competitor"; kind: "keyword" | "competitor_keyword" }> = [
    ...primary.map((kw) => ({ kw, role: "primary" as const, kind: "keyword" as const })),
    ...comp.map((kw) => ({ kw, role: "competitor" as const, kind: "competitor_keyword" as const })),
  ];

  for (const { kw, role, kind } of entries) {
    for (const platform of config.platforms) {
      targets.push({ targetKind: kind, targetValue: kw, platform });
      specs.push({
        role,
        targetLabel: kw,
        sourceInput: platform === "reddit"
          ? {
              platform: "reddit", primaryProvider: "kaix", fallbackProvider: "red_crawler",
              deliveryMode: "pull", contentKind: "post", feedLane: "monitor_only",
              label: `KW Reddit: ${kw}`.slice(0, 100), schedule,
              target: { type: "search", query: kw, sort: config.sort ?? "top", timeRange: "week", minLikes: config.minLikes, minComments: config.minComments },
            }
          : {
              platform: "x", primaryProvider: "twitterapis", fallbackProvider: "scrapebadger",
              deliveryMode: "pull", contentKind: "post", feedLane: "monitor_only",
              label: `KW X: ${kw}`.slice(0, 100), schedule,
              target: { type: "search", query: kw, sort: config.sort ?? "top", minLikes: config.minLikes, minComments: config.minComments, excludeReposts: config.excludeReposts ?? true, language: config.language },
            },
      });
    }
  }
  return { specs, targets };
}

function buildAuthorSpecs(
  config: MonitorConfigValue,
  schedule: ReturnType<typeof buildSchedule>,
): { specs: ProvisionSpec[]; targets: TargetRow[] } {
  const handles = config.handles ?? [];
  if (!handles.length) fail(422, "Author monitor requires at least one handle");
  const specs: ProvisionSpec[] = [];
  const targets: TargetRow[] = [];
  const xHandles: string[] = [];
  for (const item of handles) {
    const clean = item.handle.trim().replace(/^[@u/]+/i, "").toLowerCase();
    if (!clean) continue;
    targets.push({ targetKind: "author", targetValue: clean, platform: item.platform });
    if (item.platform === "x") {
      xHandles.push(clean);
    } else {
      specs.push({
        role: "bundle_member",
        targetLabel: `u/${clean}`,
        sourceInput: {
          platform: "reddit", primaryProvider: "kaix", deliveryMode: "pull", contentKind: "post",
          feedLane: "monitor_only", label: `KOL Reddit: u/${clean}`.slice(0, 100), schedule,
          target: { type: "account", account: clean, sort: config.sort ?? "new" },
        },
      });
    }
  }
  for (const [idx, batch] of packXAccountBatches(xHandles, 15).entries()) {
    specs.push({
      role: "bundle_member",
      targetLabel: batch.join(","),
      sourceInput: {
        platform: "x", primaryProvider: "twitterapis", fallbackProvider: "scrapebadger",
        deliveryMode: "pull", contentKind: "post", feedLane: "monitor_only",
        label: `KOL X Batch #${idx + 1} (${batch.length})`.slice(0, 100), schedule,
        target: { type: "account", account: batch[0], accounts: batch, sort: config.sort ?? "new", excludeReposts: config.excludeReposts ?? true },
      },
    });
  }
  if (!specs.length) fail(422, "Author monitor requires valid Reddit or X handles");
  return { specs, targets };
}

function buildCommunitySpecs(
  config: MonitorConfigValue,
  schedule: ReturnType<typeof buildSchedule>,
): { specs: ProvisionSpec[]; targets: TargetRow[] } {
  const subs = [
    ...new Set((config.subreddits ?? []).map((s) => s.trim().replace(/^r\//i, "").toLowerCase()).filter(Boolean)),
  ];
  if (!subs.length) fail(422, "Community bundle monitor requires at least one subreddit");
  const specs: ProvisionSpec[] = [];
  const targets: TargetRow[] = [];
  for (const sub of subs) {
    targets.push({ targetKind: "subreddit", targetValue: sub, platform: "reddit" });
    specs.push({
      role: "bundle_member",
      targetLabel: `r/${sub}`,
      sourceInput: {
        platform: "reddit", primaryProvider: "kaix", fallbackProvider: "red_crawler",
        deliveryMode: "pull", contentKind: "post", feedLane: "monitor_only",
        label: `Subreddit: r/${sub}`.slice(0, 100), schedule,
        target: { type: "community", community: sub, sort: config.sort ?? "hot", timeRange: "week", minLikes: config.minLikes, minComments: config.minComments },
      },
    });
  }
  return { specs, targets };
}

export async function provisionMonitorSources(
  client: PoolClient,
  providers: ContentProvider[],
  monitorId: string,
  kind: MonitorKindValue,
  config: MonitorConfigValue,
  intervalHours: number,
) {
  const schedule = buildSchedule(intervalHours);
  const plan = kind === "keyword"
    ? buildKeywordSpecs(config, schedule)
    : kind === "author_list"
      ? buildAuthorSpecs(config, schedule)
      : buildCommunitySpecs(config, schedule);

  await client.query("DELETE FROM intel_monitor_source WHERE monitor_id=$1", [monitorId]);
  await client.query("DELETE FROM intel_monitor_target WHERE monitor_id=$1", [monitorId]);

  for (const spec of plan.specs) {
    const cs = await ensureManagedSource(client, providers, spec.sourceInput);
    await client.query(
      `INSERT INTO intel_monitor_source(monitor_id, collection_source_id, role, target_label)
       VALUES($1, $2, $3, $4)
       ON CONFLICT (monitor_id, collection_source_id) DO UPDATE SET role=EXCLUDED.role, target_label=EXCLUDED.target_label`,
      [monitorId, cs.id, spec.role, spec.targetLabel],
    );
  }

  for (const t of plan.targets) {
    await client.query(
      `INSERT INTO intel_monitor_target(id, monitor_id, target_kind, target_value, platform)
       VALUES($1, $2, $3, $4, $5)
       ON CONFLICT (monitor_id, target_kind, platform, target_value) DO NOTHING`,
      [randomUUID(), monitorId, t.targetKind, t.targetValue, t.platform],
    );
  }

  return { sourceCount: plan.specs.length, targetCount: plan.targets.length };
}

export async function estimateMonitorCollection(
  pool: Pool,
  input: {
    sourceCount: number;
    dailyItemBudget: number;
    limitPerSource: number;
    includeComments: boolean;
    maxCommentsPerPost: number;
  },
) {
  const usage = await getProviderDailyUsage(pool, ["kaix", "red_crawler", "twitterapis", "scrapebadger"]);
  const resourcesToday = usage.reduce((sum, u) => sum + u.resourcesToday, 0);
  const perSourceMultiplier = input.includeComments ? 1 + input.maxCommentsPerPost : 1;
  const estimatedRequests = input.sourceCount;
  const estimatedMaxItems = input.sourceCount * input.limitPerSource * perSourceMultiplier;
  return {
    sourceCount: input.sourceCount,
    estimatedRequests,
    estimatedMaxItems,
    monitorDailyBudget: input.dailyItemBudget,
    systemDailyCeiling: DAILY_SOCIAL_ITEM_CEILING,
    systemResourcesToday: resourcesToday,
    remainingSystemDailyBudget: Math.max(0, DAILY_SOCIAL_ITEM_CEILING - resourcesToday),
    exceedsMonitorBudget: estimatedMaxItems > input.dailyItemBudget,
    exceedsSystemCeiling: resourcesToday + estimatedMaxItems > DAILY_SOCIAL_ITEM_CEILING,
    providers: usage,
  };
}
