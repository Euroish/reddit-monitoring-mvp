import { LIVE_COLLECTION_WINDOW_MINUTES } from "../../../src/workers/reddit-phase1-defaults";

export const READYZ_THRESHOLDS = {
  activeSessionLookbackMinutes: 30,
  providerHealthLookbackMinutes: 30,
  providerHealthSuccessRateMin: 0.7,
  providerHealthFallbackRateMax: 0.6,
  providerHealthEmptyRateMax: 0.85,
  providerHealthDiffRateMax: 0.3,
  providerHealthErrorRateMax: 0.25,
  providerHealthRateLimitRateMax: 0.15,
  providerHealthTimeoutRateMax: 0.12,
  providerHealthCircuitOpenRateMax: 0.08,
  providerHealthSwitchShareMax: 0.2,
  staleHeadDuplicatePostRateMin: 0.55,
  staleHeadIngestLagSecondsMin: 5400,
  cursorStallThresholdSeconds: LIVE_COLLECTION_WINDOW_MINUTES * 3 * 60,
} as const;
