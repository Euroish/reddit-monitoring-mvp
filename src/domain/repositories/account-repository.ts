import type { Account } from "../entities/account";

export interface AccountRepository {
  upsertMany(accounts: Account[]): Promise<void>;
  findByExternalId(externalId: string): Promise<Account | null>;
}

