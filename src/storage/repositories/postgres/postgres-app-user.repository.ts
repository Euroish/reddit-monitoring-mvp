import type { AppUser, AppUserPassword } from "../../../domain/entities/app-user";
import type {
  CreateWithConsumedInviteResult,
  AppUserRepository,
  AppUserWithPassword,
} from "../../../domain/repositories/app-user-repository";
import type { PostgresClient } from "../../postgres/postgres-client";

interface AppUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: AppUser["role"];
  status: AppUser["status"];
  created_at: Date;
  updated_at: Date;
}

interface AppUserWithPasswordRow extends AppUserRow {
  password_hash: string;
  password_algo: string;
  password_updated_at: Date;
}

function mapAppUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapAppUserWithPassword(row: AppUserWithPasswordRow): AppUserWithPassword {
  return {
    user: mapAppUser(row),
    password: {
      userId: row.id,
      passwordHash: row.password_hash,
      passwordAlgo: row.password_algo,
      updatedAt: row.password_updated_at.toISOString(),
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class PostgresAppUserRepository implements AppUserRepository {
  constructor(private readonly db: PostgresClient) {}

  public async create(user: AppUser, password: AppUserPassword): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(
        `
        INSERT INTO app_user (
          id, email, display_name, role, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          user.id,
          user.email,
          user.displayName ?? null,
          user.role,
          user.status,
          user.createdAt,
          user.updatedAt,
        ],
      );
      await client.query(
        `
        INSERT INTO app_user_password (
          user_id, password_hash, password_algo, updated_at
        ) VALUES ($1, $2, $3, $4)
        `,
        [password.userId, password.passwordHash, password.passwordAlgo, password.updatedAt],
      );
    });
  }

  public async createWithConsumedInvite(
    user: AppUser,
    password: AppUserPassword,
    inviteId: string,
    nowIso: string,
  ): Promise<CreateWithConsumedInviteResult> {
    try {
      return await this.db.withTransaction(async (client) => {
        const consumed = await client.query<{ id: string }>(
          `
          UPDATE app_invite
          SET used_count = used_count + 1
          WHERE id = $1
            AND status = 'active'
            AND used_count < max_uses
            AND (expires_at IS NULL OR expires_at > $2)
          RETURNING id
          `,
          [inviteId, nowIso],
        );
        if (consumed.rows.length === 0) {
          return "invite_unavailable";
        }

        await client.query(
          `
          INSERT INTO app_user (
            id, email, display_name, role, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            user.id,
            user.email,
            user.displayName ?? null,
            user.role,
            user.status,
            user.createdAt,
            user.updatedAt,
          ],
        );
        await client.query(
          `
          INSERT INTO app_user_password (
            user_id, password_hash, password_algo, updated_at
          ) VALUES ($1, $2, $3, $4)
          `,
          [password.userId, password.passwordHash, password.passwordAlgo, password.updatedAt],
        );
        return "created";
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "email_already_registered";
      }
      throw error;
    }
  }

  public async findByEmailWithPassword(email: string): Promise<AppUserWithPassword | null> {
    const result = await this.db.query<AppUserWithPasswordRow>(
      `
      SELECT
        u.id,
        u.email,
        u.display_name,
        u.role,
        u.status,
        u.created_at,
        u.updated_at,
        p.password_hash,
        p.password_algo,
        p.updated_at AS password_updated_at
      FROM app_user u
      JOIN app_user_password p ON p.user_id = u.id
      WHERE lower(u.email) = lower($1)
      LIMIT 1
      `,
      [email],
    );
    return result.rows.length > 0 ? mapAppUserWithPassword(result.rows[0]) : null;
  }

  public async findById(id: string): Promise<AppUser | null> {
    const result = await this.db.query<AppUserRow>(
      `
      SELECT id, email, display_name, role, status, created_at, updated_at
      FROM app_user
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );
    return result.rows.length > 0 ? mapAppUser(result.rows[0]) : null;
  }

  public async list(): Promise<AppUser[]> {
    const result = await this.db.query<AppUserRow>(
      `
      SELECT id, email, display_name, role, status, created_at, updated_at
      FROM app_user
      ORDER BY created_at DESC, email ASC
      `,
    );
    return result.rows.map(mapAppUser);
  }

  public async updateStatus(
    id: string,
    status: AppUser["status"],
    updatedAt: string,
  ): Promise<AppUser | null> {
    const result = await this.db.query<AppUserRow>(
      `
      UPDATE app_user
      SET status = $2,
          updated_at = $3
      WHERE id = $1
      RETURNING id, email, display_name, role, status, created_at, updated_at
      `,
      [id, status, updatedAt],
    );
    return result.rows.length > 0 ? mapAppUser(result.rows[0]) : null;
  }
}
