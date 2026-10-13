import "../../../src/runtime/load-local-env";
import {
  createPostgresPhase1Runtime,
} from "../../../src/runtime/reddit-phase1-runtime";
import { parseBooleanFlag, parsePort, parsePositiveInt } from "../../../src/runtime/runtime-parsing";
import { assertProductionLaunchConfig } from "./public-launch-config";
import { createApiServer } from "./create-api-server";
import { createSourceContentService } from "../../../src/runtime/source-content-runtime";
import { ContentPersonalService } from "../../../src/application/services/content-personal.service";
import { PostgresContentPersonalRepository } from "../../../src/storage/repositories/postgres/postgres-content-personal.repository";

const port = parsePort(process.env.PORT, 3000);
const apiBearerToken = process.env.API_BEARER_TOKEN?.trim();
if (!apiBearerToken) {
  throw new Error("API_BEARER_TOKEN is required");
}

const corsAllowOrigins = (process.env.API_CORS_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const corsMaxAgeSeconds = Number.parseInt(process.env.API_CORS_MAX_AGE_SECONDS ?? "300", 10);
const sessionCookieSecure = parseBooleanFlag(
  process.env.API_SESSION_COOKIE_SECURE,
  process.env.NODE_ENV === "production",
);
const allowInsecureSessionCookieInProduction = parseBooleanFlag(
  process.env.API_ALLOW_INSECURE_SESSION_COOKIE,
  false,
);
const rateLimitEnabled = parseBooleanFlag(process.env.API_RATE_LIMIT_ENABLED, true);
const rateLimitPoints = parsePositiveInt(process.env.API_RATE_LIMIT_POINTS, 60);
const rateLimitDurationSeconds = parsePositiveInt(
  process.env.API_RATE_LIMIT_DURATION_SECONDS,
  60,
);
assertProductionLaunchConfig({
  nodeEnv: process.env.NODE_ENV,
  corsAllowOrigins: corsAllowOrigins,
  sessionCookieSecure,
  allowInsecureSessionCookieInProduction,
});
const runtime = createPostgresPhase1Runtime();
const sourceContent = createSourceContentService(runtime.db);

const server = createApiServer({
  sourceContent,
  contentPersonal: new ContentPersonalService(new PostgresContentPersonalRepository(runtime.db), sourceContent),
  repositories: runtime.repositories,
  sqlDb: runtime.db,
  createConnector: runtime.createConnector,
  redditMapper: runtime.redditMapper,
  auth: {
    bearerToken: apiBearerToken,
    sessionCookieSecure,
  },
  cors: {
    allowedOrigins: corsAllowOrigins,
    maxAgeSeconds: Number.isFinite(corsMaxAgeSeconds) ? corsMaxAgeSeconds : 300,
  },
  rateLimit: {
    enabled: rateLimitEnabled,
    points: rateLimitPoints,
    durationSeconds: rateLimitDurationSeconds,
  },
});

const host = process.env.API_HOST ?? "0.0.0.0";
server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://${host}:${port}`);
});

async function closeGracefully(): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await runtime.close();
}

process.on("SIGINT", () => {
  void closeGracefully().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void closeGracefully().finally(() => process.exit(0));
});
