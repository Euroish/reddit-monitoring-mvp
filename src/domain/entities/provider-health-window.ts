import type { ISODateTime, UUID } from "../../shared/types/common";
import type { CrawlMode } from "./crawl-cursor";

export interface ProviderHealthWindow {
  provider: string;
  targetId: UUID;
  mode: CrawlMode;
  windowStart: ISODateTime;
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
  lastStatusCode?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastScraplingProfile?: "http" | "dynamic" | "stealth";
  lastScraplingFetcher?: string;
  lastScraplingSessionKey?: string;
  updatedAt: ISODateTime;
}
