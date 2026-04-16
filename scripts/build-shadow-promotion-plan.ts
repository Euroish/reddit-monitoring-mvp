import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildShadowPromotionPlan,
  type ShadowCompareSnapshot,
  type ShadowPromotionPolicy,
} from "../src/application/services/shadow-promotion-plan.service";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveNowTag(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function loadSnapshots(args: {
  docsDir: string;
  maxSnapshots: number;
}): Promise<Array<{ fileName: string; snapshot: ShadowCompareSnapshot }>> {
  const entries = await readdir(args.docsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name.startsWith("live-shadow-compare-") && name.toLowerCase().endsWith(".json"),
    )
    .sort();

  const selected = files.slice(-args.maxSnapshots);
  const output: Array<{ fileName: string; snapshot: ShadowCompareSnapshot }> = [];
  for (const fileName of selected) {
    const fullPath = path.resolve(args.docsDir, fileName);
    const raw = await readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw) as ShadowCompareSnapshot;
    output.push({
      fileName,
      snapshot: parsed,
    });
  }
  return output;
}

function resolvePolicyFromEnv(env: NodeJS.ProcessEnv): Partial<ShadowPromotionPolicy> {
  return {
    minSamples: parsePositiveInt(env.REDDIT_SHADOW_PLAN_MIN_SAMPLES, 4),
    minBaselineSuccessRate: parsePositiveFloat(
      env.REDDIT_SHADOW_PLAN_MIN_BASELINE_SUCCESS_RATE,
      0.99,
    ),
    minShadowSuccessRate: parsePositiveFloat(
      env.REDDIT_SHADOW_PLAN_MIN_SHADOW_SUCCESS_RATE,
      0.99,
    ),
    minParityGatePassRate: parsePositiveFloat(
      env.REDDIT_SHADOW_PLAN_MIN_GATE_PASS_RATE,
      0.95,
    ),
    minJaccardP50: parsePositiveFloat(env.REDDIT_SHADOW_PLAN_MIN_JACCARD_P50, 0.95),
    minJaccardMin: parsePositiveFloat(env.REDDIT_SHADOW_PLAN_MIN_JACCARD_MIN, 0.9),
    maxAbsExtractedDeltaP95: parsePositiveFloat(
      env.REDDIT_SHADOW_PLAN_MAX_ABS_EXTRACTED_DELTA_P95,
      3,
    ),
    maxAbsLagDeltaSecondsP95: parsePositiveFloat(
      env.REDDIT_SHADOW_PLAN_MAX_ABS_LAG_DELTA_SECONDS_P95,
      120,
    ),
    maxDurationRatioP95: parsePositiveFloat(
      env.REDDIT_SHADOW_PLAN_MAX_DURATION_RATIO_P95,
      6,
    ),
  };
}

function buildMarkdown(args: {
  generatedAt: string;
  includedSnapshots: string[];
  plan: ReturnType<typeof buildShadowPromotionPlan>;
}): string {
  const lines: string[] = [];
  lines.push("# Shadow Promotion Plan");
  lines.push("");
  lines.push(`- Generated at: ${args.generatedAt}`);
  lines.push(`- Snapshot count: ${args.plan.snapshotCount}`);
  lines.push(`- Eligible subreddits: ${args.plan.eligibleSubreddits.length}`);
  lines.push(
    `- Included snapshots: ${args.includedSnapshots.length > 0 ? args.includedSnapshots.join(", ") : "(none)"}`,
  );
  lines.push("");
  lines.push("## Policy");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(args.plan.policy, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Decisions");
  lines.push("");
  lines.push(
    "| Subreddit | Samples | Baseline Success | Shadow Success | Gate Pass | Jaccard P50 | Jaccard Min | Extracted Delta P95 | Lag Delta P95 (s) | Duration Ratio P95 | Eligible | Recommendation |",
  );
  lines.push(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  );
  for (const item of args.plan.subreddits) {
    lines.push(
      `| ${item.subreddit} | ${item.sampleCount} | ${item.baselineSuccessRate.toFixed(3)} | ${item.shadowSuccessRate.toFixed(3)} | ${item.parityGatePassRate.toFixed(3)} | ${formatNullable(item.jaccardP50)} | ${formatNullable(item.jaccardMin)} | ${item.absExtractedDeltaP95.toFixed(3)} | ${formatNullable(item.absLagDeltaSecondsP95)} | ${formatNullable(item.durationRatioP95)} | ${item.eligible ? "yes" : "no"} | ${item.recommendation} |`,
    );
  }
  lines.push("");
  lines.push("## Blocking Reasons");
  lines.push("");
  for (const item of args.plan.subreddits) {
    if (item.blockingReasons.length === 0) {
      continue;
    }
    lines.push(`### ${item.subreddit}`);
    lines.push("");
    for (const reason of item.blockingReasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatNullable(value: number | null): string {
  return value == null ? "null" : value.toFixed(3);
}

async function main(): Promise<void> {
  const docsDir = path.resolve(process.cwd(), "docs");
  const maxSnapshots = parsePositiveInt(
    process.env.REDDIT_SHADOW_PLAN_MAX_SNAPSHOTS,
    20,
  );
  const loaded = await loadSnapshots({
    docsDir,
    maxSnapshots,
  });
  if (loaded.length === 0) {
    throw new Error("No live-shadow-compare snapshots found in docs/");
  }

  const plan = buildShadowPromotionPlan({
    snapshots: loaded.map((item) => item.snapshot),
    policy: resolvePolicyFromEnv(process.env),
  });

  const now = new Date();
  const nowTag = resolveNowTag(now);
  const jsonPath = path.resolve(docsDir, `shadow-promotion-plan-${nowTag}.json`);
  const mdPath = path.resolve(docsDir, `shadow-promotion-plan-${nowTag}.md`);
  const payload = {
    generatedAt: now.toISOString(),
    includedSnapshots: loaded.map((item) => item.fileName),
    ...plan,
  };
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(
    mdPath,
    buildMarkdown({
      generatedAt: payload.generatedAt,
      includedSnapshots: payload.includedSnapshots,
      plan,
    }),
    "utf8",
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        event: "reddit.shadow_promotion_plan.completed",
        jsonPath,
        mdPath,
        eligibleSubreddits: plan.eligibleSubreddits,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        event: "reddit.shadow_promotion_plan.failed",
        message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

