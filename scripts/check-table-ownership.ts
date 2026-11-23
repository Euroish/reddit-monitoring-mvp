import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Enforces strict single-writer and bounded-reader SQL table ownership across `src/modules/<domain>/`.
 *
 * Rules:
 * 1. Every table has a single owning domain module for INSERT/UPDATE/DELETE statements (no shared writes).
 * 2. Tables are read only by their owning module except explicit read-only contracts in SHARED_READ_ALLOWLIST.
 */

const SHARED_WRITE_ALLOWLIST: Record<string, { allowedModules: string[]; reason: string }> = {};

const SHARED_READ_ALLOWLIST: Record<string, { allowedModules: string[]; reason: string }> = {
  source: {
    allowedModules: ["collection", "content"],
    reason: "Seeded platform lookup table owned by collection and joined for platform code by content queries.",
  },
  collection_source: {
    allowedModules: ["collection", "content"],
    reason: "Visibility & source metadata boundary joined by content queries.",
  },
};

const EXPLICIT_OWNERS: Array<{ match: RegExp; owner: string }> = [
  { match: /^app_[a-z0-9_]+$/, owner: "access" },
  { match: /^doc_page$/, owner: "docs" },
  { match: /^(?:content|content_discovery|content_observation|content_author_profile|public_content_search_document)$/, owner: "content" },
  { match: /^(?:source|collection_source|collection_batch(?:_item)?|source_.+|plan_collection_policy|user_provider_usage)$/, owner: "collection" },
  { match: /^monitor_project(?:_source|_batch)?$/, owner: "projects" },
  { match: /^(?:content_saved_query|content_annotation)$/, owner: "workspace" },
  { match: /^feed_user_.+$/, owner: "feed" },
  { match: /^intel_.+$/, owner: "intelligence" },
  { match: /^ai_.+$/, owner: "ai" },
];

const SINGLE_WORD_TABLES = new Set(["content", "source"]);
const SQL_WRITE_REGEX = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:public\.)?([a-z][a-z0-9_]+)\b/gi;
const SQL_READ_REGEX = /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:public\.)?([a-z][a-z0-9_]+)\b/gi;
const IGNORE_IDENTIFIERS = new Set(["set", "where", "values", "only", "the", "a", "from", "table"]);

function isTrackedIdentifier(ident: string) {
  return !IGNORE_IDENTIFIERS.has(ident) && (SINGLE_WORD_TABLES.has(ident) || ident.includes("_"));
}

function stripNonSqlText(source: string): string {
  return source
    .replace(/^import\b[\s\S]*?from\s+["'][^"']+["'];?/gm, "")
    .replace(/^export\b[\s\S]*?from\s+["'][^"']+["'];?/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

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
    const source = stripNonSqlText(readFileSync(file, "utf8"));

    for (const match of source.matchAll(SQL_WRITE_REGEX)) {
      const table = match[1].toLowerCase();
      if (!isTrackedIdentifier(table)) continue;
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

export function auditTableReadOwnership(repoRoot: string): {
  tablesChecked: number;
  violations: string[];
} {
  const modulesDir = join(repoRoot, "src", "modules");
  const readers = new Map<string, Map<string, Set<string>>>();

  for (const file of walkTs(modulesDir)) {
    const rel = relative(modulesDir, file).replace(/\\/g, "/");
    const domain = rel.split("/")[0];
    const source = stripNonSqlText(readFileSync(file, "utf8"));

    for (const match of source.matchAll(SQL_READ_REGEX)) {
      const table = match[1].toLowerCase();
      if (!EXPLICIT_OWNERS.some((r) => r.match.test(table))) continue;
      let domainMap = readers.get(table);
      if (!domainMap) {
        domainMap = new Map();
        readers.set(table, domainMap);
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

  for (const [table, domainMap] of [...readers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const domains = [...domainMap.keys()].sort();
    const allow = SHARED_READ_ALLOWLIST[table];
    if (allow) {
      for (const domain of domains) {
        if (!allow.allowedModules.includes(domain)) {
          violations.push(
            `Table "${table}" read by unauthorized module "${domain}" (${[...(domainMap.get(domain) ?? [])].join(", ")}); allowed readers: ${allow.allowedModules.join(", ")}`,
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
            `Table "${table}" is owned by [${validOwners.join("|")}] and has no cross-module read allowlist entry, but is read by "${domain}" (${[...(domainMap.get(domain) ?? [])].join(", ")})`,
          );
        }
      }
    }
  }

  return { tablesChecked: readers.size, violations };
}

if (require.main === module) {
  const root = resolve(__dirname, "..");
  const writes = auditTableWriteOwnership(root);
  const reads = auditTableReadOwnership(root);
  const allViolations = [...writes.violations, ...reads.violations];
  if (allViolations.length > 0) {
    console.error("Table ownership check failed:");
    for (const v of allViolations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    `Table ownership check passed: ${writes.tablesChecked} written tables (strict single-writer) and ${reads.tablesChecked} read tables verified across src/modules/.`,
  );
}
