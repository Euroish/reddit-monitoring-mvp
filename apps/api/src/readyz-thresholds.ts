import { REDDIT_PROVIDER_HEALTH_THRESHOLDS } from "../../../src/runtime/reddit-provider-health-thresholds";

export const READYZ_THRESHOLDS = {
  activeSessionLookbackMinutes: 30,
  ...REDDIT_PROVIDER_HEALTH_THRESHOLDS,
} as const;
