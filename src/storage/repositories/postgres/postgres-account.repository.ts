import type { Account } from "../../../domain/entities/account";
import type { AccountRepository } from "../../../domain/repositories/account-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import { mapAccount, type AccountRow } from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray, maxIso, minIso, minNullableIso } from "./postgres-sql.utils";

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(accounts: Account[]): Promise<void> {
    if (accounts.length === 0) {
      return;
    }

    const deduped = this.dedupeAccounts(accounts);
    const sourceId = SOURCE_IDS.reddit;
    const chunkSize = 500;

    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(deduped, chunkSize)) {
        const values: unknown[] = [];
        for (const account of group) {
          values.push(
            account.id,
            sourceId,
            account.externalId,
            account.username,
            account.isDeleted,
            account.createdAtSource ?? null,
            account.firstSeenAt,
            account.lastSeenAt,
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 8);
        await client.query(
          `
          INSERT INTO account (
            id, source_id, external_id, username, is_deleted, created_at_source, first_seen_at, last_seen_at
          ) VALUES ${placeholders}
          ON CONFLICT (source_id, external_id)
          DO UPDATE SET
            username = EXCLUDED.username,
            is_deleted = EXCLUDED.is_deleted,
            created_at_source = COALESCE(account.created_at_source, EXCLUDED.created_at_source),
            first_seen_at = LEAST(account.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(account.last_seen_at, EXCLUDED.last_seen_at)
          `,
          values,
        );
      }
    });
  }

  public async findByExternalId(externalId: string): Promise<Account | null> {
    const result = await this.db.query<AccountRow>(
      `
      SELECT id, external_id, username, is_deleted, created_at_source, first_seen_at, last_seen_at
      FROM account
      WHERE source_id = $1
        AND external_id = $2
      LIMIT 1
      `,
      [SOURCE_IDS.reddit, externalId],
    );

    return result.rows.length > 0 ? mapAccount(result.rows[0]) : null;
  }

  private dedupeAccounts(accounts: Account[]): Account[] {
    const byExternalId = new Map<string, Account>();

    for (const account of accounts) {
      const current = byExternalId.get(account.externalId);
      if (!current) {
        byExternalId.set(account.externalId, { ...account });
        continue;
      }

      const next: Account = {
        ...current,
        username: account.lastSeenAt >= current.lastSeenAt ? account.username : current.username,
        isDeleted: current.isDeleted || account.isDeleted,
        createdAtSource: minNullableIso(current.createdAtSource, account.createdAtSource),
        firstSeenAt: minIso(current.firstSeenAt, account.firstSeenAt),
        lastSeenAt: maxIso(current.lastSeenAt, account.lastSeenAt),
      };

      byExternalId.set(account.externalId, next);
    }

    return Array.from(byExternalId.values());
  }
}
