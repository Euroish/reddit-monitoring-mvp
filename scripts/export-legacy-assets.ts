import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import QueryStream from "pg-query-stream";
import { createPool } from "../src/storage/db";

export async function exportLegacyAssets(
  connectionString: string,
  directory: string,
) {
  await mkdir(directory, { mode: 0o700 });
  const pool = createPool(connectionString),
    client = await pool.connect();
  const files: {
    file: string;
    ownerId: string;
    rows: number;
    sha256: string;
  }[] = [];
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='35s'");
    const users = (await client.query("SELECT id FROM app_user ORDER BY id"))
      .rows;
    const tables = [
      "research_export",
      "content_saved_query",
      "content_annotation",
      "saved_workbench_view",
    ] as const;
    for (const user of users) {
      for (const table of [...tables, "research_export_member"] as const) {
        const sql =
          table === "research_export_member"
            ? "SELECT m.* FROM research_export_member m JOIN research_export e ON e.id=m.export_id WHERE e.user_id=$1 ORDER BY m.export_id,m.ordinal"
            : `SELECT * FROM ${table} WHERE user_id=$1`;
        const rows = client.query(
          new QueryStream(sql, [user.id], { batchSize: 100 }),
        );
        let count = 0;
        const file = `${user.id}-${table}.json`;
        async function* json() {
          yield "[";
          for await (const row of rows) {
            yield `${count ? "," : ""}${JSON.stringify(row)}`;
            count++;
          }
          yield "]\n";
        }
        await pipeline(
          Readable.from(json()),
          createWriteStream(path.join(directory, file), {
            flags: "wx",
            mode: 0o600,
          }),
        );
        const expected = (
          await client.query(`SELECT COUNT(*) FROM (${sql}) AS archived`, [
            user.id,
          ])
        ).rows[0].count;
        if (BigInt(expected) !== BigInt(count))
          throw new Error("Asset file count mismatch");
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(path.join(directory, file)))
          digest.update(chunk);
        files.push({
          file,
          ownerId: user.id,
          rows: count,
          sha256: digest.digest("hex"),
        });
      }
    }
    await client.query("COMMIT");
    const manifest = {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      files,
      delivered: false,
      databaseChanged: false,
    };
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    return manifest;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
}
if (require.main === module) {
  const directory = path.resolve(
    process.argv[2] ?? `output/legacy-assets-${Date.now()}`,
  );
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  void exportLegacyAssets(process.env.DATABASE_URL, directory)
    .then((result) =>
      console.log(
        JSON.stringify({
          directory,
          files: result.files.length,
          databaseChanged: false,
        }),
      ),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Export failed");
      process.exitCode = 1;
    });
}
