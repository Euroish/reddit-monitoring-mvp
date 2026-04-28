import type {
  StorageObservabilityRepository,
  StorageObservabilitySnapshot,
} from "../../../domain/repositories/storage-observability-repository";

export class InMemoryStorageObservabilityRepository implements StorageObservabilityRepository {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  public async getSnapshot(): Promise<StorageObservabilitySnapshot> {
    return {
      capturedAtIso: this.now(),
      databaseSizeBytes: 0,
      tables: [
        {
          tableName: "reddit_fetch_event",
          rowEstimate: 0,
          tableBytes: 0,
          indexBytes: 0,
          totalBytes: 0,
        },
        {
          tableName: "raw_reddit_event",
          rowEstimate: 0,
          tableBytes: 0,
          indexBytes: 0,
          totalBytes: 0,
        },
        {
          tableName: "metrics_snapshot",
          rowEstimate: 0,
          tableBytes: 0,
          indexBytes: 0,
          totalBytes: 0,
        },
        {
          tableName: "post_engagement_latest",
          rowEstimate: 0,
          tableBytes: 0,
          indexBytes: 0,
          totalBytes: 0,
        },
        {
          tableName: "post_engagement_window",
          rowEstimate: 0,
          tableBytes: 0,
          indexBytes: 0,
          totalBytes: 0,
        },
      ],
    };
  }
}
