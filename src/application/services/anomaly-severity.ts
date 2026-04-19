export type AnomalySeverity = "low" | "medium" | "high";

export function resolveAnomalySeverity(anomalyScore: number): AnomalySeverity {
  if (anomalyScore >= 0.8) {
    return "high";
  }
  if (anomalyScore >= 0.5) {
    return "medium";
  }
  return "low";
}
