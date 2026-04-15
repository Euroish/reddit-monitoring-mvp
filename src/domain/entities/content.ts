import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";

export type ContentKind = "post";

export interface Content {
  id: UUID;
  source: SourceCode;
  targetId: UUID;
  accountId?: UUID;
  externalId: string;
  kind: ContentKind;
  title: string;
  bodyText?: string;
  url?: string;
  permalink: string;
  createdAtSource: ISODateTime;
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
}

