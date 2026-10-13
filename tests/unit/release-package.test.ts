import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

test("release packaging allowlist excludes credentials/data and verification detects tampering or extra files", async () => {
  const { packRelease, verifyRelease } = await import("../../scripts/release-package-lib.mjs");
  await mkdir("output/validation", { recursive: true });
  const root = await mkdtemp(path.resolve("output/validation/release-fixture-"));
  for (const folder of ["dist/apps/api/src", "dist/workers", "apps/web/dist", "src/storage/schema", "deploy/env"])
    await mkdir(path.join(root, folder), { recursive: true });
  for (const [file, content] of [
    ["dist/apps/api/src/server.js", "console.log('synthetic-api');"], ["dist/workers/source-content-worker.js", "console.log('synthetic-worker');"],
    ["apps/web/dist/index.html", "<html lang='en'>synthetic</html>"], ["src/storage/schema/001_fixture.sql", "SELECT 1;"],
    ["package.json", JSON.stringify({ name: "synthetic", version: "0.7.0" })], ["package-lock.json", "{}"],
    [".env.local", "secret=must-not-package"], ["dist/.env", "secret=must-not-package"],
    ["deploy/env/sources.env.example", "SOURCE_NETWORK_ENABLED=false"], ["deploy/env/private.env", "secret=must-not-package"],
  ]) await writeFile(path.join(root, file), content);
  const destination = path.join(root, "output/release-a");
  const manifest = await packRelease({ root, destination });
  assert.ok(manifest.files.some(file => file.path === "dist/workers/source-content-worker.js"));
  assert.ok(!manifest.files.some(file => file.path.endsWith(".env") || file.path.includes(".env.local")));
  assert.equal((await verifyRelease(destination)).verified, true);
  await assert.rejects(packRelease({ root, destination }), /already exists/);
  await appendFile(path.join(destination, "dist/apps/api/src/server.js"), "tampered");
  await assert.rejects(verifyRelease(destination), /integrity/);
  const extra = path.join(root, "output/release-b"); await packRelease({ root, destination: extra });
  await writeFile(path.join(extra, ".env"), "extra-private-file");
  await assert.rejects(verifyRelease(extra), /inventory/);
});
