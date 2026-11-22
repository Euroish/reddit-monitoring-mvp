import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const distDir = path.join(root, "apps/web/dist");
const indexHtmlPath = path.join(distDir, "index.html");
const assetsDir = path.join(distDir, "assets");

const errors = [];
const warnings = [];

if (!fs.existsSync(indexHtmlPath)) {
  console.error(`Missing frontend build output: ${indexHtmlPath}. Run "npm run build:web" first.`);
  process.exit(1);
}

const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");

// 1. Guard: public homepage initial HTML must never eagerly preload/load the charts (ECharts) chunk.
const eagerRefs = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)].map((m) => m[1]);
for (const ref of eagerRefs) {
  if (/(?:^|\/)charts-[^/]+\.js$/i.test(ref)) {
    errors.push(
      `Homepage index.html eagerly loads charts chunk (${ref}). Keep ECharts lazy-loaded via React.lazy.`,
    );
  }
}

// 2. Inspect built JS chunks: verify entry chunk does not statically import charts and no backend secrets leaked.
const FORBIDDEN_SECRET_PATTERNS = [
  /\bVITE_(?:APIFY_API_TOKEN|CREDENTIALS_MASTER_KEY|SESSION_SECRET|TWITTERAPIS_API_KEY|SCRAPEBADGER_API_KEY|DATABASE_URL|AI_API_KEY)\b/,
  /\bapify_api_[A-Za-z0-9]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^/\s"']+:[^@\s"']+@/,
];

const ENTRY_WARN_BYTES = 550 * 1024;
const stats = [];

if (fs.existsSync(assetsDir)) {
  const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js")).sort();
  for (const file of jsFiles) {
    const full = path.join(assetsDir, file);
    const bytes = fs.statSync(full).size;
    const content = fs.readFileSync(full, "utf8");
    stats.push({ file, bytes });

    for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`Built web asset ${file} contains forbidden server secret identifier ${pattern}.`);
      }
    }

    if (/^index-[^/]+\.js$/i.test(file)) {
      // Static import of charts-*.js from entry bundle violates lazy analytics boundary.
      if (/from\s*["']\.\/charts-[^"']+\.js["']/.test(content)) {
        errors.push(
          `Entry bundle ${file} statically imports charts chunk. Keep ECharts behind React.lazy.`,
        );
      }
      if (bytes > ENTRY_WARN_BYTES) {
        warnings.push(
          `Entry bundle ${file} is ${(bytes / 1024).toFixed(1)} KiB (> ${(ENTRY_WARN_BYTES / 1024).toFixed(0)} KiB advisory budget).`,
        );
      }
    }
  }
} else {
  errors.push(`Missing frontend assets directory: ${assetsDir}`);
}

const topChunks = stats
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 6)
  .map((s) => `${s.file}=${(s.bytes / 1024).toFixed(1)}KiB`)
  .join(", ");

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}

console.log(`Web bundle boundary check passed (${stats.length} JS chunks; top: ${topChunks}).`);
