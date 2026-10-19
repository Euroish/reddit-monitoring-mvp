import { SourceContentService } from "../application/services/source-content.service";
import { ArcticShiftContentConnector } from "../connectors/reddit/arctic-shift-content.connector";
import { BlueskyAppViewContentConnector } from "../connectors/bluesky/bluesky-appview-content.connector";
import { DemoContentProvider } from "../connectors/demo/demo-content.connector";
import { TwitterApiIoContentConnector } from "../connectors/x/twitterapi-io-content.connector";
import { resolveTwitterApiIoConfig } from "../connectors/x/twitterapi-io.config";
import type { ContentProvider } from "../connectors/shared/content-provider.interface";
import { PostgresClient } from "../storage/postgres/postgres-client";
import { PostgresSourceContentRepository } from "../storage/repositories/postgres/postgres-source-content.repository";
import { assertCollectionExecutionAllowed } from "./collection-execution-policy";
import { validateRuntimeEnvironment } from "./environment-config";
export function createSourceContentService(db: PostgresClient) {
  const mode = process.env.SOURCE_RUN_MODE ?? "live";
  if (!["demo", "live"].includes(mode)) throw new Error("SOURCE_RUN_MODE must be demo or live");
  validateRuntimeEnvironment();
  if (mode === "demo") assertCollectionExecutionAllowed("demo");
  const networkEnabled = mode === "live" && process.env.SOURCE_NETWORK_ENABLED === "true";
  const arctic = new ArcticShiftContentConnector();
  if (!networkEnabled) Object.defineProperty(arctic, "capability", { value: { ...arctic.capability, enabled: false, limitations: [...arctic.capability.limitations, "External requests disabled by local runtime configuration."] } });
  const x = new TwitterApiIoContentConnector({ ...resolveTwitterApiIoConfig(), networkEnabled });
  const bluesky = new BlueskyAppViewContentConnector({ networkEnabled });
  const providers: ContentProvider[] = [...(mode === "demo" ? [new DemoContentProvider("reddit"), new DemoContentProvider("x")] : []), arctic, x, bluesky];
  return new SourceContentService(new PostgresSourceContentRepository(db),providers);
}
