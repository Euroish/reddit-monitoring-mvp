export interface StorageTableStat {
  tableName: string;
  rowEstimate: number;
  tableBytes: number;
  indexBytes: number;
  totalBytes: number;
}

export interface StorageObservabilitySnapshot {
  capturedAtIso: string;
  databaseSizeBytes: number;
  tables: StorageTableStat[];
}

export interface StorageObservabilityRepository {
  getSnapshot(): Promise<StorageObservabilitySnapshot>;
}
