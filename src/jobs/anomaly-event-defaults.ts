export const ANOMALY_EVENT_DEFAULTS = {
  algorithmVersion: "anomaly_event_v2_tier_directional_quality",
  minScore: {
    volume: 0.6,
    quality: 0.55,
    keyword: 0.6,
    driver: 0.75,
  },
  qualityTierScoreMin: {
    micro: 0.62,
    small: 0.58,
    mid: 0.55,
    large: 0.52,
  },
  qualityBaselineFloorByTier: {
    micro: 0.12,
    small: 0.1,
    mid: 0.08,
    large: 0.06,
  },
  incidentMergeBoostBySignal: {
    volume: 0.08,
    quality: 0.04,
    keyword: 0.08,
    driver: 0.06,
  },
  maxKeywordEventsPerDay: 3,
  driverEventLimit: 80,
} as const;
