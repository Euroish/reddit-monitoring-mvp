export type ValidationClassification =
  | "repo-side complete"
  | "host verification deferred"
  | "host verification required now";

export interface ValidationScopeResult {
  classification: ValidationClassification;
  categories: string[];
  reasons: string[];
  repoCommands: string[];
  hostCommands: string[];
}

export interface ClassifyValidationScopeArgs {
  files: string[];
  milestone?: boolean;
}

const DEPLOY_PATTERNS = [
  /^deploy\//i,
  /^docs\/deployment-runbook\.md$/i,
];

const MIGRATION_PATTERNS = [
  /^src\/storage\/schema\/.+\.sql$/i,
  /^src\/storage\/schema\/run-migrations\.ts$/i,
];

const PUBLIC_READINESS_PATTERNS = [
  /^apps\/api\/src\/create-api-server\.ts$/i,
  /^apps\/api\/src\/readyz-[^/]+\.ts$/i,
  /^apps\/api\/src\/auth-cookie\.ts$/i,
  /^scripts\/smoke-public-launch\.ts$/i,
];

const PROVIDER_RUNTIME_PATTERNS = [
  /^scripts\/linux-provider-smoke\.ts$/i,
  /^workers\/reddit-phase1-scheduler\.ts$/i,
  /^src\/runtime\/.+\.ts$/i,
  /^src\/connectors\/reddit\/.+\.ts$/i,
];

function normalizeFiles(files: string[]): string[] {
  return Array.from(
    new Set(
      files
        .map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "").trim())
        .filter((file) => file.length > 0),
    ),
  );
}

function matchesAny(file: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(file));
}

export function classifyValidationScope(
  args: ClassifyValidationScopeArgs,
): ValidationScopeResult {
  const files = normalizeFiles(args.files);
  const milestone = args.milestone ?? false;
  const categories = new Set<string>();
  const reasons: string[] = [];

  if (files.length === 0) {
    return {
      classification: "repo-side complete",
      categories: [],
      reasons: ["No changed files were supplied, so no host-only validation boundary was detected."],
      repoCommands: ["npm run verify:repo"],
      hostCommands: [],
    };
  }

  for (const file of files) {
    if (matchesAny(file, DEPLOY_PATTERNS)) {
      categories.add("deploy");
    }
    if (matchesAny(file, MIGRATION_PATTERNS)) {
      categories.add("migration");
    }
    if (matchesAny(file, PUBLIC_READINESS_PATTERNS)) {
      categories.add("public-readiness");
    }
    if (matchesAny(file, PROVIDER_RUNTIME_PATTERNS)) {
      categories.add("provider-runtime");
    }
  }

  if (categories.has("deploy")) {
    reasons.push(
      "Changed deploy/runtime assets affect Nginx, env, systemd, or rollout procedure and should eventually be proved on the target host.",
    );
  }
  if (categories.has("migration")) {
    reasons.push(
      "Changed migration or schema code can only be fully proved against a real persisted database state.",
    );
  }
  if (categories.has("public-readiness")) {
    reasons.push(
      "Changed auth/cookie/CORS/public readiness code affects launch semantics that local tests can simulate first but not fully prove under the real host/domain.",
    );
  }
  if (categories.has("provider-runtime")) {
    reasons.push(
      "Changed provider or Linux runtime code depends on real host networking and provider reachability, so host proof should happen at a deployment milestone.",
    );
  }

  const repoCommands = [
    "npm run verify:repo",
  ];
  if (
    categories.has("deploy") ||
    categories.has("migration") ||
    categories.has("public-readiness") ||
    categories.has("provider-runtime")
  ) {
    repoCommands.push("npm run verify:launch:local");
  }

  const hostCommands =
    categories.size === 0
      ? []
      : [
          "npm run db:migrate:compiled",
          "npm run auth:bootstrap-owner:compiled",
          "node dist/scripts/linux-provider-smoke.js",
          "PUBLIC_BASE_URL=https://<domain> npm run smoke:public-launch",
        ];

  return {
    classification:
      categories.size === 0
        ? "repo-side complete"
        : milestone
          ? "host verification required now"
          : "host verification deferred",
    categories: Array.from(categories).sort((left, right) => left.localeCompare(right)),
    reasons:
      reasons.length > 0
        ? reasons
        : ["Changed files stay inside repo-verifiable boundaries."],
    repoCommands,
    hostCommands,
  };
}
