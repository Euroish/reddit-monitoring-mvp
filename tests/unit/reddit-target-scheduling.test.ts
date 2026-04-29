import assert from "node:assert/strict";
import test from "node:test";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import type { MonitorTarget } from "../../src/domain/entities/monitor-target";
import {
  DEFAULT_FAVORITE_TARGET_CADENCE_HOURS,
  isFavoriteTargetDueForLiveCollection,
  resolveFavoriteTargetScheduleConfig,
  selectTargetsForLiveCollection,
} from "../../src/workers/reddit-target-scheduling";

function createTarget(args: {
  canonicalName: string;
  config?: Record<string, unknown>;
}): MonitorTarget {
  return {
    id: stableUuidFromString(`reddit:target:${args.canonicalName}`),
    source: "reddit",
    targetType: "subreddit",
    canonicalName: args.canonicalName,
    status: "active",
    config: args.config ?? {},
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
  };
}

test("resolveFavoriteTargetScheduleConfig reads nested config with default 8h cadence", () => {
  const target = createTarget({
    canonicalName: "r/datascience",
    config: {
      collection: {
        live: {
          favorite: true,
        },
      },
    },
  });

  assert.deepEqual(resolveFavoriteTargetScheduleConfig(target), {
    favorite: true,
    cadenceHours: DEFAULT_FAVORITE_TARGET_CADENCE_HOURS,
  });
});

test("resolveFavoriteTargetScheduleConfig honors provided runtime cadence fallback", () => {
  const target = createTarget({
    canonicalName: "r/datascience",
    config: {
      collection: {
        live: {
          favorite: true,
        },
      },
    },
  });

  assert.deepEqual(resolveFavoriteTargetScheduleConfig(target, 6), {
    favorite: true,
    cadenceHours: 6,
  });
});

test("selectTargetsForLiveCollection falls back to all active targets when no favorite config exists", () => {
  const targets = [
    createTarget({ canonicalName: "r/a" }),
    createTarget({ canonicalName: "r/b" }),
  ];

  assert.deepEqual(
    selectTargetsForLiveCollection({
      targets,
      nowIso: "2026-04-27T02:20:00.000Z",
    }).map((target) => target.canonicalName),
    ["r/a", "r/b"],
  );
});

test("favorite target live scheduling only returns targets due for the current cadence slot", () => {
  const nowIso = "2026-04-27T02:20:00.000Z";
  const favoriteConfig = {
    collection: {
      live: {
        favorite: true,
        cadenceHours: 8,
      },
    },
  };
  const candidateTargets = Array.from({ length: 512 }, (_, index) =>
    createTarget({
      canonicalName: `r/slot-${index}`,
      config: favoriteConfig,
    }),
  );
  const dueTarget = candidateTargets.find((target) =>
    isFavoriteTargetDueForLiveCollection({
      target,
      nowIso,
    }),
  );
  const laterTarget = candidateTargets.find(
    (target) =>
      !isFavoriteTargetDueForLiveCollection({
        target,
        nowIso,
      }),
  );

  if (!dueTarget || !laterTarget) {
    throw new Error("failed to construct due and non-due favorite targets for cadence test");
  }

  const dueTargets = selectTargetsForLiveCollection({
    targets: [dueTarget, laterTarget],
    nowIso,
  });

  assert.equal(
    dueTargets.every((target) =>
      isFavoriteTargetDueForLiveCollection({
        target,
        nowIso,
      }),
    ),
    true,
  );
  assert.equal(
    dueTargets.some((target) => target.id === laterTarget.id),
    isFavoriteTargetDueForLiveCollection({
      target: laterTarget,
      nowIso,
    }),
  );
  assert.equal(
    dueTargets.some((target) => target.id === dueTarget.id),
    isFavoriteTargetDueForLiveCollection({
      target: dueTarget,
      nowIso,
    }),
  );
  assert.deepEqual(
    dueTargets.map((target) => target.id),
    [dueTarget.id],
  );
});
