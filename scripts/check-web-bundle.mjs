import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const distDir = path.join(root, "apps/web/dist");
const indexHtmlPath = path.join(distDir, "index.html");
const assetsDir = path.join(distDir, "assets");

const errors = [];

if (!fs.existsSync(indexHtmlPath)) {
  console.error(`Missing frontend build output: ${indexHtmlPath}. Run "npm run build:web" first.`);
  process.exit(1);
}

// Guard built JS chunks against leaked server secrets or database credentials.
const FORBIDDEN_SECRET_PATTERNS = [
  /\bVITE_(?:APIFY_API_TOKEN|CREDENTIALS_MASTER_KEY|SESSION_SECRET|TWITTERAPIS_API_KEY|SCRAPEBADGER_API_KEY|DATABASE_URL|AI_API_KEY)\b/,
  /\bapify_api_[A-Za-z0-9]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^/\s"']+:[^@\s"']+@/,
];

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
  }
} else {
  errors.push(`Missing frontend assets directory: ${assetsDir}`);
}

const topChunks = stats
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 6)
  .map((s) => `${s.file}=${(s.bytes / 1024).toFixed(1)}KiB`)
  .join(", ");

if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}

console.log(`Web bundle check passed (${stats.length} JS chunks scanned for leaked secrets; top: ${topChunks}).`);
