import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Enforces single-writer SQL table ownership across `src/modules/<domain>/`.
 *
 * Rules:
 * 1. Core tables have a single owning domain module for INSERT/UPDATE/DELETE statements.
 * 2. Any newly introduced table must also have at most one writing module (no silent
 *    multi-module writes), unless explicitly listed in SHARED_WRITE_ALLOWLIST.
 */

const SHARED_WRITE_ALLOWLIST: Record<string, { allowedModules: string[]; reason: string }> = {
  app_audit_log: {
    allowedModules: ["access", "collection"],
    reason: "Shared append-only security/collection audit log.",
  },
  app_user: {
    allowedModules: ["access", "collection"],
    reason: "Legacy quota_override update in collection/policy.ts; extract to access/index.ts in cleanup.",
  },
};

const EXPLICIT_OWNERS: Array<{ match: RegExp; owner: string }> = [
  { match: /^app_(?:user|user_password|session|invite|auth_.+)$/, owner: "access" },
  {
    match: /^(?:collection_source|collection_batch(?:_item)?|source_.+|plan_collection_policy|user_provider_usage)$/,
    owner: "collection",
  },
  { match: /^(?:content_saved_query|content_annotation)$/, owner: "workspace" },
  { match: /^monitor_project(?:_source|_batch)?$/, owner: "projects" },
  { match: /^(?:content_discovery|content_observation|public_content_search_document|doc_page)$/, owner: "content" },
  { match: /^ai_.+$/, owner: "ai" },
];

const SQL_WRITE_REGEX = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z][a-z0-9_]+)\b/gi;
const IGNORE_IDENTIFIERS = new Set(["set", "where", "values", "only", "the", "a", "from", "table"]);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

export function auditTableWriteOwnership(repoRoot: string): {
  tablesChecked: number;
  violations: string[];
} {
  const modulesDir = join(repoRoot, "src", "modules");
  const writers = new Map<string, Map<string, Set<string>>>();

  for (const file of walkTs(modulesDir)) {
    const rel = relative(modulesDir, file).replace(/\\/g, "/");
    const domain = rel.split("/")[0];
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SQL_WRITE_REGEX)) {
      const table = match[1].toLowerCase();
      if (IGNORE_IDENTIFIERS.has(table) || !table.includes("_")) continue;
      let domainMap = writers.get(table);
      if (!domainMap) {
        domainMap = new Map();
        writers.set(table, domainMap);
      }
      let files = domainMap.get(domain);
      if (!files) {
        files = new Set();
        domainMap.set(domain, files);
      }
      files.add(`src/modules/${rel}`);
    }
  }

  const violations: string[] = [];

  for (const [table, domainMap] of [...writers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const domains = [...domainMap.keys()].sort();
    const allow = SHARED_WRITE_ALLOWLIST[table];
    if (allow) {
      for (const domain of domains) {
        if (!allow.allowedModules.includes(domain)) {
          violations.push(
            `Table "${table}" written by unauthorized module "${domain}" (${[...(domainMap.get(domain) ?? [])].join(", ")}); allowed: ${allow.allowedModules.join(", ")}`,
          );
        }
      }
      continue;
    }

    const rule = EXPLICIT_OWNERS.find((r) => r.match.test(table));
    if (rule) {
      const validOwners = rule.owner.split("|");
      for (const domain of domains) {
        if (!validOwners.includes(domain)) {
          violations.push(
            `Table "${table}" is owned by [${validOwners.join("|")}] but written by "${domain}" (${[...(domainMap.get(domain) ?? [])].join(", ")})`,
          );
        }
      }
    }

    if (domains.length > 1) {
      violations.push(
        `Table "${table}" has multiple write-owner modules [${domains.join(", ")}]; route writes through the single owning module's index.ts facade.`,
      );
    }
  }

  return { tablesChecked: writers.size, violations };
}

if (require.main === module) {
  const root = resolve(__dirname, "..");
  const result = auditTableWriteOwnership(root);
  if (result.violations.length > 0) {
    console.error("Table write-ownership check failed:");
    for (const v of result.violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`Table write-ownership check passed: ${result.tablesChecked} written tables verified across src/modules/.`);
}
