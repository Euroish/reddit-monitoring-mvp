import type { ContentDetailResponse } from "../../../packages/contracts/src/source-content";
import type { SourceContentRepository } from "../../domain/repositories/source-content-repository";
import { SourceContentError } from "../../domain/source-content-error";
import { requireSourceId } from "../../domain/source-content-validation";

type DetailRepository = Pick<SourceContentRepository,
  "getContent" | "findContentsByIdentity" | "relatedChildren" | "listSources"
>;

/** Resolve only stored content; batch bounded identities, not one query per reference. */
export async function contentDetail(
  repository: DetailRepository,
  id: string,
): Promise<Omit<ContentDetailResponse, "ok" | "requestId">> {
  const content = await repository.getContent(requireSourceId(id));
  if (!content) throw new SourceContentError("Content not found", "not_found");

  const relatedLimit = 20;
  const references = content.references.slice(0, relatedLimit);
  const sourceIds = [...new Set(content.observations.map(item => item.sourceId))];
  const [related, children, sources] = await Promise.all([
    repository.findContentsByIdentity(content.platform, references),
    repository.relatedChildren(content, relatedLimit + 1),
    repository.listSources(sourceIds),
  ]);
  // Platform is fixed by the query. Keep kind in the key: post/comment IDs may coincide.
  const byIdentity = new Map(related.map(item => [JSON.stringify([item.kind, item.externalId]), item]));
  return {
    content, sources,
    references: references.map(reference => ({
      reference, content: byIdentity.get(JSON.stringify([reference.kind, reference.externalId])) ?? null,
    })),
    children: children.slice(0, relatedLimit),
    relatedLimit,
    relatedTruncated: content.references.length > relatedLimit || children.length > relatedLimit,
    scope: "stored_content",
  };
}
