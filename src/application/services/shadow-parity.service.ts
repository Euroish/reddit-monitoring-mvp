export interface ShadowProviderSample {
  provider: string;
  status: number | null;
  durationMs: number;
  extractedCount: number;
  uniqueExternalCount: number;
  duplicateWithinResponse: number;
  avgIngestLagSeconds: number | null;
  errorMessage?: string;
}

export interface ShadowParityResult {
  statusMatch: boolean;
  bothSucceeded: boolean;
  extractedDelta: number;
  overlapCount: number;
  unionCount: number;
  overlapJaccard: number | null;
  avgIngestLagDeltaSeconds: number | null;
}

export function buildShadowParityResult(args: {
  baseline: ShadowProviderSample;
  shadow: ShadowProviderSample;
  baselineExternalIds: string[];
  shadowExternalIds: string[];
}): ShadowParityResult {
  const baselineSet = new Set(args.baselineExternalIds);
  const shadowSet = new Set(args.shadowExternalIds);
  const overlapCount = countOverlap(baselineSet, shadowSet);
  const unionCount = new Set([...baselineSet, ...shadowSet]).size;
  const overlapJaccard =
    unionCount > 0 ? round(overlapCount / unionCount, 6) : null;

  return {
    statusMatch: args.baseline.status === args.shadow.status,
    bothSucceeded: isSuccessfulStatus(args.baseline.status) && isSuccessfulStatus(args.shadow.status),
    extractedDelta: args.shadow.extractedCount - args.baseline.extractedCount,
    overlapCount,
    unionCount,
    overlapJaccard,
    avgIngestLagDeltaSeconds: resolveLagDeltaSeconds(
      args.baseline.avgIngestLagSeconds,
      args.shadow.avgIngestLagSeconds,
    ),
  };
}

export function evaluateShadowParityGate(args: {
  parity: ShadowParityResult;
  minJaccard: number;
  maxExtractedDeltaAbs: number;
  requireStatusMatch: boolean;
}): boolean {
  if (!args.parity.bothSucceeded) {
    return false;
  }
  if (args.requireStatusMatch && !args.parity.statusMatch) {
    return false;
  }
  if (Math.abs(args.parity.extractedDelta) > args.maxExtractedDeltaAbs) {
    return false;
  }
  if (args.parity.overlapJaccard == null) {
    return false;
  }
  return args.parity.overlapJaccard >= args.minJaccard;
}

function countOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const key of left) {
    if (right.has(key)) {
      overlap += 1;
    }
  }
  return overlap;
}

function resolveLagDeltaSeconds(
  baselineLag: number | null,
  shadowLag: number | null,
): number | null {
  if (baselineLag == null || shadowLag == null) {
    return null;
  }
  return round(shadowLag - baselineLag, 3);
}

function isSuccessfulStatus(status: number | null): boolean {
  return status != null && status >= 200 && status < 300;
}

function round(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

