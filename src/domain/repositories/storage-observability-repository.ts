export interface StorageTableStat {
  tableName: string;
  /** PostgreSQL statistics estimate; may be stale or zero before statistics exist. */
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
