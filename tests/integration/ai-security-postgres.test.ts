import assert from "node:assert/strict";
import test from "node:test";
import { extractWithOptionalLlm } from "../../src/modules/content/ai-llm";
import { testDatabase } from "../helpers/database";

test("PG16 reserves each paid extraction before fetch and retains unknown outcomes across retries", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  let calls = 0;
  const options = {
    apiUrl: "https://llm.example.test/extract",
    apiKey: "fixture-key",
    dailyBudget: 1,
    fetcher: async (_url: string, init: RequestInit) => {
      assert.equal(init.redirect, "error");
      calls++;
      throw new Error("fixture network interruption");
    },
  };
  const input = {
    referenceId: "fixture-reference", vendorName: "Fixture vendor", title: "First document",
    bodyText: "Fixture evidence", publishedDate: null, url: "https://vendor.example.test/article",
  };
  const other = { ...input, title: "Second document" };
  const outcomes = await Promise.all([input, other].map((item) => extractWithOptionalLlm(db.pool, item, options)));
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["budget_exceeded", "invalid"]);
  assert.equal(calls, 1);
  const attempted = outcomes[0].status === "invalid" ? input : other;
  assert.deepEqual(await extractWithOptionalLlm(db.pool, attempted, options), {
    status: "invalid", reason: "LLM request outcome unknown",
  });
  assert.equal(calls, 1);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM ai_llm_extraction_cache")).rows[0].n, 1);
});
