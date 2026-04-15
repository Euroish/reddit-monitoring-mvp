import test from "node:test";
import assert from "node:assert/strict";

test("run-migrations module import is side-effect free", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    await assert.doesNotReject(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("../../src/storage/schema/run-migrations");
    });
  } finally {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});
