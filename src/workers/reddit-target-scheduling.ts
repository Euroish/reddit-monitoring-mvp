import type { MonitorTarget } from "../domain/entities/monitor-target";

export const DEFAULT_FAVORITE_TARGET_CADENCE_HOURS = 8;
const SCHEDULER_SLOT_MINUTES = 5;

interface FavoriteTargetScheduleConfig {
  favorite: boolean;
  cadenceHours: number;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stableStringHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function resolveFavoriteTargetScheduleConfig(
  target: MonitorTarget,
): FavoriteTargetScheduleConfig | null {
  const config = readObject(target.config) ?? {};
  const collection = readObject(config.collection);
  const live = readObject(collection?.live);
  const schedule = readObject(config.schedule);

  const favorite =
    readBoolean(live?.favorite) ??
    readBoolean(schedule?.favorite) ??
    readBoolean(config.favorite) ??
    false;
  if (!favorite) {
    return null;
  }

  const cadenceHours =
    readPositiveInt(live?.cadenceHours) ??
    readPositiveInt(schedule?.liveCadenceHours) ??
    readPositiveInt(config.cadenceHours) ??
    DEFAULT_FAVORITE_TARGET_CADENCE_HOURS;

  return {
    favorite: true,
    cadenceHours,
  };
}

export function isFavoriteTargetDueForLiveCollection(args: {
  target: MonitorTarget;
  nowIso: string;
}): boolean {
  const schedule = resolveFavoriteTargetScheduleConfig(args.target);
  if (!schedule) {
    return false;
  }

  const nowMs = new Date(args.nowIso).getTime();
  if (!Number.isFinite(nowMs)) {
    return false;
  }

  const cadenceSlots = Math.max(
    1,
    Math.floor((schedule.cadenceHours * 60) / SCHEDULER_SLOT_MINUTES),
  );
  const absoluteSlot = Math.floor(nowMs / (SCHEDULER_SLOT_MINUTES * 60 * 1000));
  const targetSlotOffset = stableStringHash(args.target.id) % cadenceSlots;
  return absoluteSlot % cadenceSlots === targetSlotOffset;
}

export function selectTargetsForLiveCollection(args: {
  targets: MonitorTarget[];
  nowIso: string;
}): MonitorTarget[] {
  const favoriteTargets = args.targets.filter((target) => resolveFavoriteTargetScheduleConfig(target));
  if (favoriteTargets.length === 0) {
    return args.targets;
  }

  return favoriteTargets.filter((target) =>
    isFavoriteTargetDueForLiveCollection({
      target,
      nowIso: args.nowIso,
    }),
  );
}
