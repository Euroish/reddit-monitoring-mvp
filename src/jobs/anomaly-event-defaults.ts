export const ANOMALY_EVENT_DEFAULTS = {
  algorithmVersion: "anomaly_event_v1",
  minScore: {
    volume: 0.6,
    quality: 0.55,
    keyword: 0.6,
    driver: 0.75,
  },
  maxKeywordEventsPerDay: 3,
  driverEventLimit: 80,
} as const;
