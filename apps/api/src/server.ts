import {
  createPostgresPhase1Runtime,
} from "../../../src/runtime/reddit-phase1-runtime";
import { parseBooleanFlag, parsePort, parsePositiveInt } from "../../../src/runtime/runtime-parsing";
import { createApiServer } from "./create-api-server";

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
const rateLimitEnabled = parseBooleanFlag(process.env.API_RATE_LIMIT_ENABLED, true);
const rateLimitPoints = parsePositiveInt(process.env.API_RATE_LIMIT_POINTS, 60);
const rateLimitDurationSeconds = parsePositiveInt(
  process.env.API_RATE_LIMIT_DURATION_SECONDS,
  60,
);
const runtime = createPostgresPhase1Runtime();

const server = createApiServer({
  repositories: runtime.repositories,
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

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
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
