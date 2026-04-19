import type { CrawlMode } from "../entities/crawl-cursor";
import type { ProviderHealthWindow } from "../entities/provider-health-window";

export interface RecordProviderHealthWindowInput {
  provider: string;
  targetId: string;
  mode: CrawlMode;
  windowStart: string;
  requestCountDelta: number;
  successCountDelta: number;
  emptyResponseCountDelta: number;
  fallbackCountDelta: number;
  candidateCountDelta: number;
  acceptedCountDelta: number;
  filteredOutCountDelta: number;
  duplicatePostCountDelta: number;
  ingestLagSecondsSumDelta: number;
  ingestLagSampleCountDelta: number;
  providerDiffCountDelta: number;
  providerDiffSampleCountDelta: number;
  errorCountDelta: number;
  rateLimitCountDelta: number;
  timeoutCountDelta: number;
  circuitOpenCountDelta: number;
  scraplingHttpProfileCountDelta?: number;
  scraplingDynamicProfileCountDelta?: number;
  scraplingStealthProfileCountDelta?: number;
  scraplingSessionKeyCountDelta?: number;
  scraplingSessionKeyReuseCountDelta?: number;
  lastStatusCode?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastScraplingProfile?: "http" | "dynamic" | "stealth";
  lastScraplingFetcher?: string;
  lastScraplingSessionKey?: string;
  updatedAt: string;
}

export interface ProviderHealthAggregate {
  provider: string;
  mode: CrawlMode;
  requestCount: number;
  successCount: number;
  emptyResponseCount: number;
  fallbackCount: number;
  candidateCount: number;
  acceptedCount: number;
  filteredOutCount: number;
  duplicatePostCount: number;
  ingestLagSecondsSum: number;
  ingestLagSampleCount: number;
  providerDiffCount: number;
  providerDiffSampleCount: number;
  errorCount: number;
  rateLimitCount: number;
  timeoutCount: number;
  circuitOpenCount: number;
  scraplingHttpProfileCount: number;
  scraplingDynamicProfileCount: number;
  scraplingStealthProfileCount: number;
  scraplingSessionKeyCount: number;
  scraplingSessionKeyReuseCount: number;
}

export interface ProviderHealthWindowRepository {
  record(input: RecordProviderHealthWindowInput): Promise<void>;
  listByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
    mode?: CrawlMode;
  }): Promise<ProviderHealthWindow[]>;
  summarizeByProviderInRange(args: {
    from: string;
    to: string;
    targetId?: string;
    mode?: CrawlMode;
  }): Promise<ProviderHealthAggregate[]>;
}
