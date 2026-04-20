import type { ISODateTime, UUID } from "../../shared/types/common";
import type { AppUserRole } from "./app-user";

export type AppInviteStatus = "active" | "disabled";

export interface AppInvite {
  id: UUID;
  codeHash: string;
  status: AppInviteStatus;
  roleOnAccept: AppUserRole;
  maxUses: number;
  usedCount: number;
  expiresAt?: ISODateTime;
  createdAt: ISODateTime;
}
