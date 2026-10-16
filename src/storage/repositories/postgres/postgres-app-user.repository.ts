import type { AppUser, AppUserPassword } from "../../../domain/entities/app-user";
import type {
  CreateWithConsumedInviteResult,
  AppUserRepository,
  AppUserWithPassword,
  AccountSecurityActor, AccountAccessResult,
} from "../../../domain/repositories/app-user-repository";
import { accountAccessPolicy } from "../../../domain/account-access-policy";
import type { PostgresClient } from "../../postgres/postgres-client";

interface AppUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: AppUser["role"];
  status: AppUser["status"];
  created_at: Date;
  updated_at: Date;
  credential_version: number;
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
    credentialVersion: row.credential_version,
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
        u.credential_version,
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
      SELECT id, email, display_name, role, status, created_at, updated_at, credential_version
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
      SELECT id, email, display_name, role, status, created_at, updated_at, credential_version
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
    const result = await this.updateAccess(id, { status }, updatedAt, { role: "machine" });
    if (result.outcome === "last_owner") throw new Error("Cannot remove the last active owner");
    return result.outcome === "updated" ? result.user : null;
  }

  public async updateAccess(id: string, changes: { role?: AppUser["role"]; status?: AppUser["status"] }, updatedAt: string, actor: AccountSecurityActor): Promise<AccountAccessResult> {
    return this.db.withTransaction(async client => {
      // All status/role mutations serialize the owner-set decision; user row locks also fence concurrent login.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('workbench.account-security'))");
      let actualActor = actor;
      if (actor.role !== "machine") {
        if (!actor.userId) return { outcome: "forbidden" };
        const actorResult = await client.query<AppUserRow>("SELECT * FROM app_user WHERE id=$1 FOR UPDATE", [actor.userId]);
        const currentActor = actorResult.rows[0];
        if (!currentActor || currentActor.status !== "active") return { outcome: "forbidden" };
        actualActor = { userId: currentActor.id, role: currentActor.role };
      }
      const result = await client.query<AppUserRow>("SELECT * FROM app_user WHERE id=$1 FOR UPDATE", [id]);
      if (!result.rows[0]) return { outcome: "not_found" };
      const current = mapAppUser(result.rows[0]), policy = accountAccessPolicy(actualActor, current, changes);
      if (policy !== "allowed") return { outcome: policy };
      const role = changes.role ?? current.role, status = changes.status ?? current.status;
      if (role === current.role && status === current.status) return { outcome: "updated", user: current };
      if (current.role === "owner" && current.status === "active" && (role !== "owner" || status !== "active")) {
        const owners = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM app_user WHERE role='owner' AND status='active' AND id<>$1", [id]);
        if (Number(owners.rows[0].count) === 0) return { outcome: "last_owner" };
      }
      const updated = await client.query<AppUserRow>("UPDATE app_user SET role=$2,status=$3,updated_at=$4,credential_version=credential_version+1 WHERE id=$1 RETURNING *", [id, role, status, updatedAt]);
      await client.query("DELETE FROM app_session WHERE user_id=$1", [id]);
      return { outcome: "updated", user: mapAppUser(updated.rows[0]) };
    });
  }

  public async replacePasswordAndRevokeSessions(userId: string, expectedVersion: number, expectedPasswordHash: string, password: AppUserPassword): Promise<boolean> {
    return this.db.withTransaction(async client => {
      const current = await client.query<{ id: string }>("SELECT id FROM app_user WHERE id=$1 AND status='active' AND credential_version=$2 FOR UPDATE", [userId, expectedVersion]);
      if (!current.rowCount) return false;
      const updated = await client.query("UPDATE app_user_password SET password_hash=$3,password_algo=$4,updated_at=$5 WHERE user_id=$1 AND password_hash=$2", [userId, expectedPasswordHash, password.passwordHash, password.passwordAlgo, password.updatedAt]);
      if (!updated.rowCount) return false;
      await client.query("UPDATE app_user SET credential_version=credential_version+1,updated_at=$2 WHERE id=$1", [userId, password.updatedAt]);
      await client.query("DELETE FROM app_session WHERE user_id=$1", [userId]);
      return true;
    });
  }

  public async invalidateSessions(userId: string, nowIso: string): Promise<boolean> {
    return this.db.withTransaction(async client => {
      const user = await client.query("UPDATE app_user SET credential_version=credential_version+1,updated_at=$2 WHERE id=$1 RETURNING id", [userId, nowIso]);
      if (!user.rowCount) return false;
      await client.query("DELETE FROM app_session WHERE user_id=$1", [userId]);
      return true;
    });
  }
}
