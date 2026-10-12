import { SourceContentService } from "../application/services/source-content.service";
import { ArcticShiftContentConnector } from "../connectors/reddit/arctic-shift-content.connector";
import { DemoContentProvider } from "../connectors/demo/demo-content.connector";
import type { ContentProvider } from "../connectors/shared/content-provider.interface";
import { PostgresClient } from "../storage/postgres/postgres-client";
import { PostgresSourceContentRepository } from "../storage/repositories/postgres/postgres-source-content.repository";
export function createSourceContentService(db: PostgresClient) {
  const providers:ContentProvider[]=process.env.SOURCE_RUN_MODE==="demo"?[new DemoContentProvider("reddit")]:[new ArcticShiftContentConnector()];
  if(process.env.SOURCE_RUN_MODE!=="demo"&&process.env.SOURCE_NETWORK_ENABLED!=="true")for(const provider of providers)Object.defineProperty(provider,"capability",{value:{...provider.capability,enabled:false,limitations:[...provider.capability.limitations,"External requests disabled: set SOURCE_NETWORK_ENABLED=true only after authorization."]}});
  return new SourceContentService(new PostgresSourceContentRepository(db),providers);
}
