import type { ISODateTime, UUID } from "../../shared/types/common";

export interface AppSession {
  id: UUID;
  userId: UUID;
  tokenHash: string;
  expiresAt: ISODateTime;
  lastSeenAt: ISODateTime;
  createdAt: ISODateTime;
}
