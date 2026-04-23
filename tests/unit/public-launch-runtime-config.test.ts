import assert from "node:assert/strict";
import test from "node:test";

import { assertProductionLaunchConfig } from "../../apps/api/src/public-launch-config";

test("production launch config accepts explicit secure origins", () => {
  assert.doesNotThrow(() =>
    assertProductionLaunchConfig({
      nodeEnv: "production",
      corsAllowOrigins: ["https://example.com", "https://app.example.com"],
      sessionCookieSecure: true,
    }),
  );
});

test("production launch config allows empty origins for same-origin deployments", () => {
  assert.doesNotThrow(() =>
    assertProductionLaunchConfig({
      nodeEnv: "production",
      corsAllowOrigins: [],
      sessionCookieSecure: true,
    }),
  );
});

test("production launch config rejects insecure session cookies", () => {
  assert.throws(
    () =>
      assertProductionLaunchConfig({
        nodeEnv: "production",
        corsAllowOrigins: ["https://example.com"],
        sessionCookieSecure: false,
      }),
    /API_SESSION_COOKIE_SECURE must be true in production/,
  );
});

test("production launch config rejects wildcard origins", () => {
  assert.throws(
    () =>
      assertProductionLaunchConfig({
        nodeEnv: "production",
        corsAllowOrigins: ["*"],
        sessionCookieSecure: true,
      }),
    /invalid origin|\* in production/,
  );
});

test("production launch config rejects origin entries with paths", () => {
  assert.throws(
    () =>
      assertProductionLaunchConfig({
        nodeEnv: "production",
        corsAllowOrigins: ["https://example.com/app"],
        sessionCookieSecure: true,
      }),
    /must be exact origins without paths/,
  );
});

test("non-production launch config stays permissive", () => {
  assert.doesNotThrow(() =>
    assertProductionLaunchConfig({
      nodeEnv: "development",
      corsAllowOrigins: [],
      sessionCookieSecure: false,
    }),
  );
});
