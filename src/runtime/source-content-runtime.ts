import { SourceContentService } from "../application/services/source-content.service";
import { ArcticShiftContentConnector } from "../connectors/reddit/arctic-shift-content.connector";
import { PostgresClient } from "../storage/postgres/postgres-client";
import { PostgresSourceContentRepository } from "../storage/repositories/postgres/postgres-source-content.repository";
export function createSourceContentService(db: PostgresClient) {
  return new SourceContentService(new PostgresSourceContentRepository(db), new ArcticShiftContentConnector());
}
