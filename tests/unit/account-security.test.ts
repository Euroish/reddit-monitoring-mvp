import assert from "node:assert/strict";
import test from "node:test";
import { accountEmailProvider } from "../../src/modules/access/email-provider";
import { decodeTotpSecret, openTotpSeed, sealTotpSeed, totpStep } from "../../src/modules/access/mfa-crypto";
import { checkNewPassword } from "../../src/modules/access/password-policy";

test("Turnstile binds hostname and action; Resend receives a fragment link and a request id", async () => {
  const env = {
    AUTH_EMAIL_ENABLED: "true", AUTH_EMAIL_FROM: "notice@example.test", RESEND_API_KEY: "fixture",
    TURNSTILE_SITE_KEY: "fixture-site", TURNSTILE_SECRET_KEY: "fixture-secret",
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let hostname = "wrong.example.test";
  const stub: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length < 3
      ? Response.json({ success: true, hostname, action: "register", challenge_ts: new Date().toISOString() })
      : Response.json({ id: "fixture-send" });
  };
  const provider = accountEmailProvider(env, "https://accounts.example.test", stub)!;
  assert.equal(await provider.verify("fixture-proof", "register"), false);
  hostname = "accounts.example.test";
  assert.equal(await provider.verify("fixture-proof", "register"), true);
  assert.equal(await provider.send("user@example.test", "register", "test-token", "test-request"), true);
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(calls[2].url, "https://api.resend.com/emails");
  assert.equal(new Headers(calls[2].init?.headers).get("Idempotency-Key"), "test-request");
  assert.match(JSON.parse(String(calls[2].init?.body)).text, /https:\/\/accounts\.example\.test\/account\/confirm#purpose=register&token=test-token/);
});

test("TOTP follows the RFC seed vector, rejects replay, and encrypts the seed per account", () => {
  const seed = decodeTotpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(totpStep(seed, "287082", 0, 59_000), 1);
  assert.equal(totpStep(seed, "287082", 1, 59_000), null);
  const key = Buffer.alloc(32, 11);
  const secret = sealTotpSeed(seed, key, "user-1");
  assert.deepEqual(openTotpSeed(secret, key, "user-1"), seed);
  assert.throws(() => openTotpSeed(secret, key, "user-2"));
});

test("new passwords reject obvious variants and repeated phrases", () => {
  assert.throws(() => checkNewPassword("password" + "123456789012"), { statusCode: 422 });
  assert.throws(() => checkNewPassword("brush".repeat(3)), { statusCode: 422 });
  assert.doesNotThrow(() => checkNewPassword("tea, lantern and moonlight"));
});
