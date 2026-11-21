import assert from "node:assert/strict";
import test from "node:test";
import { createApifyFetch } from "../../src/connectors/reddit/apify-fetch";

test("Apify relay drops caller credentials and preserves the operation", async () => {
  const fetchPage: typeof fetch = async (target, options) => {
    assert.equal(String(target), "http://10.250.249.2:8080/v2/acts/kaix~reddit-scraper/runs?waitForFinish=0");
    assert.equal(options?.method, "POST");
    assert.equal(options?.body, "{}");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("Authorization"), null);
    return new Response("{}", { status: 201 });
  };
  const request = createApifyFetch({ APIFY_RELAY_ORIGIN: "http://10.250.249.2:8080" }, fetchPage);
  assert.equal((await request("https://api.apify.com/v2/acts/kaix~reddit-scraper/runs?waitForFinish=0", {
    method: "POST", body: "{}", headers: { Authorization: "Bearer test-credential" },
  })).status, 201);
  await assert.rejects(request("https://example.com/v2/users/me"));
  assert.equal(createApifyFetch({}, fetchPage), fetchPage);
});
