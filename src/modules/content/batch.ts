import { createHash } from "node:crypto";
import type {
  PublicContentKind,
  ContentReference,
} from "../../../packages/contracts/src/source-content";
import type { CollectedContent } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";

type Item = CollectedContent;
export type ContentBatchSource = {
  id: string;
  platformId: string;
  platform: Item["platform"];
  provider: string;
  contentKinds: readonly PublicContentKind[];
};
type PreparedNode = {
  item: Item;
  firstFetchedAt: string;
  lastFetchedAt: string;
};
export type PreparedContentBatch = {
  nodes: PreparedNode[];
  observations: { item: Item; hash: string }[];
};

import { canonical } from "../../shared/canonical";
export { canonical };
function conflict(message: string): never {
  fail(409, message);
}
function identity(item: Pick<Item, "kind" | "externalId">) {
  return `${item.kind}:${item.externalId}`;
}
function compareVersion(a: Item, b: Item): number {
  const ao = a.observation.sourceObservedAt,
    bo = b.observation.sourceObservedAt;
  if ((ao !== null) !== (bo !== null)) return ao !== null ? 1 : -1;
  const time = Date.parse(ao ?? a.fetchedAt) - Date.parse(bo ?? b.fetchedAt);
  return (
    time ||
    Buffer.compare(
      Buffer.from(a.observation.evidenceKey),
      Buffer.from(b.observation.evidenceKey),
    )
  );
}
function snapshot(item: Item) {
  const { id, fetchedAt, observation, ...content } = item;
  const { fetchedAt: observationFetchedAt, ...evidence } = observation;
  return { content, evidence };
}
function mergeSameVersion(a: Item, b: Item): Item {
  const merged = { ...a };
  for (const key of ["title", "text"] as const) {
    if (a[key] !== null && b[key] !== null && a[key] !== b[key])
      conflict("Conflicting content in the same version");
    merged[key] = a[key] ?? b[key];
  }
  if (
    canonical({ ...snapshot(a).content, title: null, text: null }) !==
    canonical({ ...snapshot(b).content, title: null, text: null })
  )
    conflict("Conflicting content in the same version");
  return merged;
}

// Premerge before acquiring source/job locks; every independent observation survives.
export function prepareContentBatch(
  items: readonly Item[],
): PreparedContentBatch {
  if (
    items.length > 2000 ||
    Buffer.byteLength(JSON.stringify(items)) > 16 * 1024 * 1024
  )
    fail(413, "Content batch exceeds 2000 items or 16 MiB");
  const versions = new Map<string, Item[]>();
  const nodes = new Map<string, PreparedNode>(),
    observations = new Map<string, { item: Item; hash: string }>();
  for (const item of items) {
    if (item.platform !== items[0].platform)
      fail(422, "Page/source identity mismatch");
    const key = identity(item),
      obs = item.observation;
    const history = versions.get(key) ?? [];
    history.push(item);
    versions.set(key, history);
    if (
      item.platformDetails.platform !== item.platform ||
      !item.externalId ||
      !obs.evidenceKey ||
      !Number.isFinite(Date.parse(item.fetchedAt)) ||
      !Number.isFinite(Date.parse(obs.fetchedAt)) ||
      (obs.sourceObservedAt !== null &&
        !Number.isFinite(Date.parse(obs.sourceObservedAt)))
    )
      fail(422, "Invalid content batch identity or timestamp");
    const hash = createHash("sha256")
      .update(canonical(snapshot(item)))
      .digest("hex");
    const observationKey = canonical([
      key,
      obs.sourceId,
      obs.provider,
      obs.evidenceKey,
    ]);
    const existingObservation = observations.get(observationKey);
    if (existingObservation && existingObservation.hash !== hash)
      conflict("Conflicting observation evidence key");
    if (!existingObservation) observations.set(observationKey, { item, hash });
    const old = nodes.get(key);
    if (!old)
      nodes.set(key, {
        item,
        firstFetchedAt: item.fetchedAt,
        lastFetchedAt: item.fetchedAt,
      });
    else {
      if (Date.parse(item.fetchedAt) < Date.parse(old.firstFetchedAt))
        old.firstFetchedAt = item.fetchedAt;
      if (Date.parse(item.fetchedAt) > Date.parse(old.lastFetchedAt))
        old.lastFetchedAt = item.fetchedAt;
    }
  }
  for (const [key, history] of versions) {
    const ordered = history.sort(compareVersion);
    let accepted = ordered[0];
    if (["deleted", "removed"].includes(accepted.availability))
      accepted = { ...accepted, title: null, text: null };
    for (const candidate of ordered.slice(1)) {
      if (!compareVersion(candidate, accepted)) {
        const fetchedAt =
          Date.parse(candidate.fetchedAt) > Date.parse(accepted.fetchedAt)
            ? candidate.fetchedAt
            : accepted.fetchedAt;
        accepted = { ...mergeSameVersion(accepted, candidate), fetchedAt };
        continue;
      }
      accepted = {
        ...candidate,
        title:
          candidate.availability === "deleted" ||
          candidate.availability === "removed"
            ? null
            : (candidate.title ?? accepted.title),
        text:
          candidate.availability === "deleted" ||
          candidate.availability === "removed"
            ? null
            : (candidate.text ?? accepted.text),
      };
    }
    if (
      accepted.availability === "deleted" ||
      accepted.availability === "removed"
    )
      accepted = { ...accepted, title: null, text: null };
    nodes.get(key)!.item = accepted;
  }
  validateReferences([...nodes.values()].map((node) => node.item));
  return {
    nodes: [...nodes.values()].sort((a, b) =>
      Buffer.compare(
        Buffer.from(identity(a.item)),
        Buffer.from(identity(b.item)),
      ),
    ),
    observations: [...observations.entries()]
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([, value]) => value),
  };
}

function validateReferences(items: Item[]): void {
  const nodes = new Map(items.map((item) => [identity(item), item]));
  for (const item of items) {
    if (
      item.platform === "reddit" &&
      !new RegExp(`^${item.kind === "post" ? "t3" : "t1"}_[a-z0-9]+$`).test(
        item.externalId,
      )
    )
      fail(422, "Invalid Reddit ID prefix");
    for (const relation of ["reply_to", "thread_root"] as const) {
      const refs = item.references.filter((ref) => ref.relation === relation);
      if (new Set(refs.map(identity)).size > 1)
        conflict("Contradictory content parent/root references");
    }
    for (const ref of item.references) {
      if (
        item.platform === "reddit" &&
        !new RegExp(`^${ref.kind === "post" ? "t3" : "t1"}_[a-z0-9]+$`).test(
          ref.externalId,
        )
      )
        fail(422, "Invalid Reddit reference prefix");
    }
    const root = item.references.find((ref) => ref.relation === "thread_root");
    let current: Item | undefined = item;
    const visited = new Set<string>();
    while (current) {
      const key = identity(current);
      if (visited.has(key)) conflict("Cyclic content parent chain");
      visited.add(key);
      const parent: ContentReference | undefined = current.references.find(
        (ref) => ref.relation === "reply_to",
      );
      const parentRoot = current.references.find(
        (ref) => ref.relation === "thread_root",
      );
      if (root && parentRoot && identity(root) !== identity(parentRoot))
        conflict("Cross-root content parent chain");
      if (
        root &&
        parent?.kind === "post" &&
        item.platform === "reddit" &&
        identity(parent) !== identity(root)
      )
        conflict("Cross-root content parent chain");
      current = parent ? nodes.get(identity(parent)) : undefined;
    }
  }
}
