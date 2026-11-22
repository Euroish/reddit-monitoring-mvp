import { createPool } from "../../../src/storage/db";
import { bootstrapOwner, pruneExpiredBrowserSessions } from "../../../src/modules/access/sql";
import { accountEmailProvider } from "../../../src/modules/access/email-provider";
import { pruneAccountEmail } from "../../../src/modules/access/email-sql";
import { mfaConfig } from "../../../src/modules/access/mfa-crypto";
import { pruneMfaChallenges } from "../../../src/modules/access/mfa-sql";
import { createCredentialVault } from "../../../src/modules/collection/credentials";
import { startWorker } from "../../../src/modules/collection/worker";
import { startAiSyncScheduler } from "../../../src/modules/content/ai-scheduler";
import { KaixContentConnector } from "../../../src/connectors/reddit/kaix-content.connector";
import { redCrawler } from "../../../src/connectors/reddit/red-crawler";
import { createApifyFetch } from "../../../src/connectors/reddit/apify-fetch";
import { resolveKaixConfig } from "../../../src/connectors/reddit/kaix.config";
import { BlueskyAppViewContentConnector } from "../../../src/connectors/bluesky/bluesky-appview-content.connector";
import { scrapeBadger } from "../../../src/connectors/x/scrapebadger";
import { twitterApis } from "../../../src/connectors/x/twitterapis";
import { webSource } from "../../../src/connectors/web/sources";
import { buildApp } from "./app";

export async function main() {
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const localHttp =
    process.env.ALLOW_HTTP_DEV === "true" &&
    process.env.NODE_ENV !== "production";
  if (new URL(origin).protocol !== "https:" && !localHttp)
    throw new Error(
      "HTTPS APP_ORIGIN required; local testing needs ALLOW_HTTP_DEV=true",
    );
  const emailProvider = accountEmailProvider(process.env, origin);
  const mfa = mfaConfig(process.env);
  if (mfa && new URL(origin).protocol !== "https:") throw new Error("Administrator MFA requires HTTPS");
  const pool = createPool(undefined, 8);
  const workerPool = createPool(undefined, 4);
  try {
    const sessionSecret = process.env.SESSION_SECRET ?? "";
    const authThrottleKey = process.env.AUTH_THROTTLE_KEY || undefined;
    if (authThrottleKey && (authThrottleKey.length < 32 || authThrottleKey === sessionSecret))
      throw new Error("AUTH_THROTTLE_KEY must be independent and at least 32 characters");
    const vault = createCredentialVault(pool, sessionSecret);
    await vault.reload();
    const apifyFetch = createApifyFetch(process.env);
    const providers = [
      twitterApis(process.env, fetch, () => vault.getSecret("twitterapis")),
      scrapeBadger(process.env, fetch, () => vault.getSecret("scrapebadger")),
      webSource("newsnow"),
      webSource("feed"),
      redCrawler(process.env, apifyFetch, () => vault.getSecret("red_crawler")),
      new KaixContentConnector({
        ...resolveKaixConfig(),
        getApiToken: () => vault.getSecret("kaix"),
      }, apifyFetch),
      new BlueskyAppViewContentConnector({
        networkEnabled: process.env.SOURCE_NETWORK_ENABLED === "true",
      }),
    ];
    const strongerPasswords = process.env.AUTH_SCRYPT_V2_WRITE_ENABLED === "true";
    if (process.env.ADMIN_BOOTSTRAP_PASSWORD)
      await bootstrapOwner(
        pool,
        process.env.ADMIN_BOOTSTRAP_PASSWORD,
        process.env.ADMIN_BOOTSTRAP_EMAIL,
        strongerPasswords,
      );
    const app = await buildApp({
      pool,
      providers,
      credentialVault: vault,
      sessionSecret,
      strongerPasswords,
      authThrottleKey,
      mfa,
      origin,
      secureCookies: !localHttp,
      logger: true,
      trustedProxyAddress: process.env.TRUST_PROXY_ADDRESS,
      publicRead: process.env.PUBLIC_READ_ENABLED !== "false",
      publicRegistration: process.env.NODE_ENV !== "production" &&
        process.env.PUBLIC_REGISTRATION_ENABLED === "true",
      accountEmail: emailProvider ? {
        provider: emailProvider,
        publicRegistration: process.env.PUBLIC_REGISTRATION_ENABLED === "true",
      } : undefined,
    });
    await app.listen({
      host: process.env.HOST ?? "127.0.0.1",
      port: Number(process.env.PORT ?? 3000),
    });
    const worker = startWorker(workerPool, providers, (error) => app.log.error({ err: error }, "Collection worker failed"));
    const stopAiScheduler = startAiSyncScheduler(workerPool);
    const sessionCleanup = setInterval(() => {
      void pruneExpiredBrowserSessions(workerPool).catch(() => app.log.error("Browser session cleanup failed"));
      void pruneAccountEmail(workerPool).catch(() => app.log.error("Account challenge cleanup failed"));
      void pruneMfaChallenges(workerPool).catch(() => app.log.error("MFA challenge cleanup failed"));
    }, 60 * 60 * 1000);
    sessionCleanup.unref();
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      stopAiScheduler();
      clearInterval(sessionCleanup);
      await Promise.all([app.close(), worker.stop()]);
      await Promise.all([pool.end(), workerPool.end()]);
      clearTimeout(deadline);
    };
    process.once("SIGTERM", () => {
      void stop();
    });
    process.once("SIGINT", () => {
      void stop();
    });
  } catch (error) {
    await Promise.all([pool.end(), workerPool.end()]);
    throw error;
  }
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Startup failed");
    process.exitCode = 1;
  });
