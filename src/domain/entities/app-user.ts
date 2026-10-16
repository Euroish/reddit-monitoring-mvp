import type { ISODateTime, UUID } from "../../shared/types/common";

export type AppUserRole = "owner" | "admin" | "viewer";
export type AppUserStatus = "pending" | "active" | "disabled";

export interface AppUser {
  id: UUID;
  email: string;
  displayName?: string;
  role: AppUserRole;
  status: AppUserStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Internal optimistic credential fence; older synthetic fixtures default to zero. */
  credentialVersion?: number;
}

export interface AppUserPassword {
  userId: UUID;
  passwordHash: string;
  passwordAlgo: string;
  updatedAt: ISODateTime;
}
