import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedSavedViewRoute } from "../../apps/api/src/saved-view-route";

test("Saved comparison and target routes retain bounded filters and reject external/unknown routes", () => {
  assert.equal(isAllowedSavedViewRoute("/compare?targets=technology,science&range=7d&series=heat_price,observed_new_posts&timeframe=1d", "comparison"), true);
  assert.equal(isAllowedSavedViewRoute("/target/technology?keywords=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&series=heat_price&hiddenOverlays=keyword-a", "target"), true);
  for (const route of ["//example.test", "/target/technology?redirect=https://example.test", "/compare?range=100d", "/compare?range=7d&range=30d", "/v1/content", "https://example.test/target/technology", "/target/technology#outside", "/target/foo%2Fbar"]) assert.equal(isAllowedSavedViewRoute(route,"comparison"),false,route);
  assert.equal(isAllowedSavedViewRoute("/compare?targets=technology,science", "target"), false);
});
