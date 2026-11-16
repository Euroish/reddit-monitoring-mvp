import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

test("release packaging allowlist excludes credentials/data and verification detects tampering or extra files", async () => {
  const { packRelease, verifyRelease } = await import("../../scripts/release-package-lib.mjs");
  await mkdir("output/validation", { recursive: true });
  const root = await mkdtemp(path.resolve("output/validation/release-fixture-"));
  for (const folder of [
    "dist/apps/api/src", "dist/workers", "dist/plugins/zst-archive", "plugins/zst-archive",
    "apps/web/dist", "src/storage/schema", "deploy/env", "docs/history", "docs/research", "docs/plans",
  ]) await mkdir(path.join(root, folder), { recursive: true });
  for (const [file, content] of [
    ["dist/apps/api/src/server.js", "console.log('synthetic-api');"], ["dist/workers/source-content-worker.js", "console.log('synthetic-worker');"],
    ["apps/web/dist/index.html", "<html lang='en'>synthetic</html>"], ["src/storage/schema/001_fixture.sql", "SELECT 1;"],
    ["package.json", JSON.stringify({ name: "synthetic", version: "0.7.0" })], ["package-lock.json", "{}"],
    ["docs/history/handoff.md", "historical delivery"], ["docs/history/development-log.md", "historical log"],
    ["docs/research/data-sources.md", "candidate evidence"], ["docs/plans/source-expansion.md", "future design"],
    ["docs/contracts.md", "data contracts"], ["docs/design.md", "interaction design"],
    ["docs/research/source_replacement_and_twitterapi_io_removal_spec.md", "source removal and replacement spec"],
    ["docs/research/architecture_audit_and_rebuild_spec.md", "audit decisions"],
    ["dist/plugins/zst-archive/archive.js", "throw new Error('external plugin');"],
    ["plugins/zst-archive/archive.py", "raise RuntimeError('external plugin')"],
    ["docs/private-notes.md", "unapproved notes"],
    [".env.local", "secret=must-not-package"], ["dist/.env", "secret=must-not-package"],
    ["deploy/env/sources.env.example", "SOURCE_NETWORK_ENABLED=false"], ["deploy/env/private.env", "secret=must-not-package"],
  ]) await writeFile(path.join(root, file), content);
  const destination = path.join(root, "output/release-a");
  const manifest = await packRelease({ root, destination });
  assert.ok(manifest.files.some(file => file.path === "dist/workers/source-content-worker.js"));
  assert.ok(!manifest.files.some(file => file.path.endsWith(".env") || file.path.includes(".env.local")));
  for (const file of [
    "docs/history/handoff.md", "docs/history/development-log.md", "docs/research/data-sources.md",
    "docs/research/architecture_audit_and_rebuild_spec.md", "docs/research/source_replacement_and_twitterapi_io_removal_spec.md", "docs/plans/source-expansion.md",
    "docs/contracts.md", "docs/design.md",
  ]) assert.ok(manifest.files.some(entry => entry.path === file), `Missing moved/new documentation: ${file}`);
  assert.ok(!manifest.files.some(file => file.path === "docs/private-notes.md"));
  assert.ok(!manifest.files.some(file => /^(?:dist\/)?plugins\//.test(file.path)));
  assert.equal((await verifyRelease(destination)).verified, true);
  await assert.rejects(packRelease({ root, destination }), /already exists/);
  await appendFile(path.join(destination, "dist/apps/api/src/server.js"), "tampered");
  await assert.rejects(verifyRelease(destination), /integrity/);
  const extra = path.join(root, "output/release-b"); await packRelease({ root, destination: extra });
  await writeFile(path.join(extra, ".env"), "extra-private-file");
  await assert.rejects(verifyRelease(extra), /inventory/);
});
