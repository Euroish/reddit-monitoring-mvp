export const PHASE1_SAMPLING_THRESHOLDS = {
  targetSampleReliability: 0.85,
  elevatedPressureMin: {
    httpPrimary: 0.34,
    generic: 0.38,
  },
  boostPressureMin: {
    httpPrimary: 0.68,
    generic: 0.78,
  },
  strongLeadingEdge: {
    pulseMin: {
      httpPrimary: 0.62,
      generic: 0.72,
    },
    activePostRatioMin: {
      httpPrimary: 0.25,
      generic: 0.32,
    },
    qualitySupportMin: 0.25,
    coverageGapMin: 0.25,
  },
  sustainedCoverageStress: {
    coverageGapMin: {
      httpPrimary: 0.18,
      generic: 0.28,
    },
    persistenceMin: 0.35,
  },
  severeTransportFailure: {
    timeoutRateMin: {
      httpPrimary: 0.2,
      generic: 0.26,
    },
    circuitOpenRateMin: {
      httpPrimary: 0.08,
      generic: 0.12,
    },
    rateLimitRateMin: {
      httpPrimary: 0.18,
      generic: 0.24,
    },
    errorRateMin: {
      httpPrimary: 0.28,
      generic: 0.34,
    },
  },
  stressedTransport: {
    pressureMin: {
      httpPrimary: 0.42,
      generic: 0.52,
    },
    coverageGapMin: 0.12,
    leadingPulseMin: 0.35,
  },
  staleHead: {
    pressureMin: {
      httpPrimary: 0.52,
      generic: 0.6,
    },
    duplicateRateMin: {
      httpPrimary: 0.55,
      generic: 0.65,
    },
    ingestLagSecondsMin: {
      httpPrimary: 5400,
      generic: 7200,
    },
    severeDuplicateRateMin: {
      httpPrimary: 0.9,
      generic: 0.95,
    },
    severeIngestLagSecondsMin: {
      httpPrimary: 21600,
      generic: 28800,
    },
  },
  switchInstability: {
    instabilityMin: {
      httpPrimary: 0.18,
      generic: 0.24,
    },
    providerSwitchShareMin: {
      httpPrimary: 0.2,
      generic: 0.26,
    },
    boostLeadingPulseMin: {
      httpPrimary: 0.28,
      generic: 0.36,
    },
  },
  elevatedTier: {
    transportPressureMin: {
      httpPrimary: 0.3,
      generic: 0.38,
    },
    leadingPulseMin: {
      httpPrimary: 0.38,
      generic: 0.48,
    },
    qualitySupportMin: {
      httpPrimary: 0.35,
      generic: 0.5,
    },
    limitBaseRatio: {
      httpPrimary: 0.56,
      generic: 0.36,
    },
    limitPressureScale: {
      httpPrimary: 0.28,
      generic: 0.3,
    },
    limitCap: 0.92,
  },
  coldStart: {
    extraPosts: {
      httpPrimary: 8,
      generic: 4,
    },
  },
} as const;
