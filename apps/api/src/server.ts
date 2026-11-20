import { createPool } from "../../../src/storage/db";
import { bootstrapOwner } from "../../../src/modules/access/sql";
import { startWorker } from "../../../src/modules/collection/worker";
import { KaixContentConnector } from "../../../src/connectors/reddit/kaix-content.connector";
import { redCrawler } from "../../../src/connectors/reddit/red-crawler";
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
  const pool = createPool(undefined, 8);
  const workerPool = createPool(undefined, 4);
  const providers = [
    twitterApis(),
    scrapeBadger(),
    webSource("newsnow"),
    webSource("feed"),
    redCrawler(),
    new KaixContentConnector(resolveKaixConfig()),
    new BlueskyAppViewContentConnector({
      networkEnabled: process.env.SOURCE_NETWORK_ENABLED === "true",
    }),
  ];
  try {
    if (process.env.ADMIN_BOOTSTRAP_PASSWORD)
      await bootstrapOwner(
        pool,
        process.env.ADMIN_BOOTSTRAP_PASSWORD,
        process.env.ADMIN_BOOTSTRAP_EMAIL,
      );
    const app = await buildApp({
      pool,
      providers,
      sessionSecret: process.env.SESSION_SECRET ?? "",
      origin,
      secureCookies: !localHttp,
      logger: true,
      trustProxy: process.env.TRUST_PROXY_HOPS === "1" ? 1 : false,
      publicRead: process.env.PUBLIC_READ_ENABLED !== "false",
      publicRegistration: process.env.PUBLIC_REGISTRATION_ENABLED !== "false",
    });
    await app.listen({
      host: process.env.HOST ?? "127.0.0.1",
      port: Number(process.env.PORT ?? 3000),
    });
    const worker = startWorker(workerPool, providers, (error) => app.log.error({ err: error }, "Collection worker failed"));
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
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
