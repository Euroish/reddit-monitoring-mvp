import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

test("release packaging allowlist excludes credentials/data and verification detects tampering or extra files", async (t) => {
  const { DOCUMENTATION_FILES, packRelease, verifyRelease } = await import("../../scripts/release-package-lib.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "release-fixture-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  for (const folder of [
    "dist/apps/api/src", "dist/src/storage/schema", "dist/workers", "dist/plugins/zst-archive", "plugins/zst-archive",
    "apps/web/dist", "src/storage/schema", "deploy/env", "docs/research", "docs/plans",
  ]) await mkdir(path.join(root, folder), { recursive: true });
  for (const [file, content] of [
    ["dist/apps/api/src/server.js", "console.log('synthetic-api');"], ["dist/workers/source-content-worker.js", "console.log('synthetic-worker');"],
    ["dist/src/storage/schema/run-migrations.js", "console.log('synthetic-migration');"],
    ["dist/src/storage/schema/001_fixture.sql", "SELECT 1;"],
    ["apps/web/dist/index.html", "<html lang='en'>synthetic</html>"], ["src/storage/schema/001_fixture.sql", "SELECT 1;"],
    ["package.json", JSON.stringify({ name: "synthetic", version: "0.7.0" })], ["package-lock.json", "{}"],
    ["docs/research/data-sources.md", "candidate evidence"], ["docs/plans/source-expansion.md", "future design"],
    ["docs/research/source_replacement_and_twitterapi_io_removal_spec.md", "source removal and replacement spec"],
    ["docs/README.md", "product and architecture"], ["docs/architecture.md", "architecture"],
    ["docs/development.md", "development"], ["docs/status.md", "status"],
    ["docs/contracts.md", "data contracts"], ["docs/design.md", "interaction design"],
    ["docs/research/architecture_audit_and_rebuild_spec.md", "audit decisions"],
    ["dist/plugins/zst-archive/archive.js", "throw new Error('external plugin');"],
    ["plugins/zst-archive/archive.py", "raise RuntimeError('external plugin')"],
    ["docs/research/ChatGPT-讲解仓库文档-20261118-1807.md", "research input"],
    ["docs/research/product-architecture-conversation-20261118.md", "conversation archive"],
    ["docs/private-notes.md", "unapproved notes"],
    [".env.local", "secret=must-not-package"], ["dist/.env", "secret=must-not-package"],
    ["deploy/env/sources.env.example", "SOURCE_NETWORK_ENABLED=false"], ["deploy/env/private.env", "secret=must-not-package"],
  ]) await writeFile(path.join(root, file), content);
  const destination = path.join(root, "output/release-a");
  const manifest = await packRelease({ root, destination });
  assert.ok(!manifest.files.some(file => file.path === "dist/workers/source-content-worker.js"));
  assert.ok(!manifest.files.some(file => file.path.endsWith(".env") || file.path.includes(".env.local")));
  assert.deepEqual(
    manifest.files.filter(entry => entry.path.startsWith("docs/")).map(entry => entry.path).sort(),
    DOCUMENTATION_FILES.filter(file => file.startsWith("docs/")).sort(),
  );
  assert.ok(!manifest.files.some(file => file.path === "docs/private-notes.md"));
  assert.ok(!manifest.files.some(file => /^(?:dist\/)?plugins\//.test(file.path)));
  assert.equal((await verifyRelease(destination)).verified, true);
  const legacyRoot = path.join(root, "output/release-legacy");
  const legacyManifest = await packRelease({ root, destination: legacyRoot });
  for (const [legacyPath, legacyBody] of [
    ["docs/handoff.md", "historical immutable release"],
    ["docs/history/development-log.md", "historical immutable log"],
  ]) {
    await mkdir(path.dirname(path.join(legacyRoot, legacyPath)), { recursive: true });
    await writeFile(path.join(legacyRoot, legacyPath), legacyBody);
    legacyManifest.files.push({ path: legacyPath, bytes: Buffer.byteLength(legacyBody), sha256: createHash("sha256").update(legacyBody).digest("hex") });
  }
  await writeFile(path.join(legacyRoot, "release-manifest.json"), JSON.stringify(legacyManifest));
  await assert.rejects(verifyRelease(legacyRoot), /Invalid release manifest/);
  await assert.rejects(packRelease({ root, destination }), /already exists/);
  await appendFile(path.join(destination, "dist/apps/api/src/server.js"), "tampered");
  await assert.rejects(verifyRelease(destination), /integrity/);
  const extra = path.join(root, "output/release-b"); await packRelease({ root, destination: extra });
  await writeFile(path.join(extra, ".env"), "extra-private-file");
  await assert.rejects(verifyRelease(extra), /inventory/);
});
