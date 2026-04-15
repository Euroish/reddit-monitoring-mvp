import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";

export interface Account {
  id: UUID;
  source: SourceCode;
  externalId: string;
  username: string;
  isDeleted: boolean;
  createdAtSource?: ISODateTime;
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
}

