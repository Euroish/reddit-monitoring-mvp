import type { AppInvite } from "../entities/app-invite";

export interface AppInviteRepository {
  create(invite: AppInvite): Promise<void>;
  findByCodeHash(codeHash: string): Promise<AppInvite | null>;
  incrementUsedCountIfAvailable(id: string, nowIso: string): Promise<boolean>;
}
