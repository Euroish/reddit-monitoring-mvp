import { randomUUID } from "node:crypto";
import { createAppInvite } from "../src/application/use-cases/create-app-invite.use-case";
import { PasswordHashingService } from "../src/application/services/password-hashing.service";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { PostgresAppInviteRepository } from "../src/storage/repositories/postgres/postgres-app-invite.repository";
import { PostgresAppUserRepository } from "../src/storage/repositories/postgres/postgres-app-user.repository";

interface SetupArgs {
  email: string;
  password: string;
  displayName?: string;
  inviteCount: number;
  inviteCodes?: string[];
}

function parseInviteCodes(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const inviteCodes = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (inviteCodes.length === 0) {
    return undefined;
  }
  for (const inviteCode of inviteCodes) {
    if (!/^\d{6}$/.test(inviteCode)) {
      throw new Error("every invite code must be a 6-digit number");
    }
  }
  if (new Set(inviteCodes).size !== inviteCodes.length) {
    throw new Error("invite codes must be unique");
  }
  return inviteCodes;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): SetupArgs {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    parsed.set(key, next);
    index += 1;
  }

  const inviteCount = Number.parseInt(parsed.get("invite-count") ?? env.AUTH_INVITE_COUNT ?? "30", 10);
  if (!Number.isInteger(inviteCount) || inviteCount < 1 || inviteCount > 100) {
    throw new Error("invite-count must be an integer between 1 and 100");
  }

  const inviteCodes = parseInviteCodes(parsed.get("invite-codes") ?? env.AUTH_INVITE_CODES);
  if (inviteCodes && inviteCodes.length !== inviteCount) {
    throw new Error("invite-codes length must match invite-count");
  }

  return {
    email: parsed.get("email") ?? env.AUTH_ADMIN_EMAIL ?? "",
    password: parsed.get("password") ?? env.AUTH_ADMIN_PASSWORD ?? "",
    displayName: parsed.get("display-name") ?? env.AUTH_ADMIN_DISPLAY_NAME,
    inviteCount,
    inviteCodes,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (!args.email.trim() || !args.password.trim()) {
    throw new Error("email and password are required");
  }

  const db = new PostgresClient();
  const appUserRepository = new PostgresAppUserRepository(db);
  const appInviteRepository = new PostgresAppInviteRepository(db);
  const passwordHashingService = new PasswordHashingService();
  const nowIso = new Date().toISOString();

  try {
    const existing = await appUserRepository.findByEmailWithPassword(args.email);
    let adminResult: "created" | "already_exists" = "already_exists";
    let adminUserId = existing?.user.id ?? "";

    if (!existing) {
      const userId = randomUUID();
      await appUserRepository.create(
        {
          id: userId,
          email: args.email.trim().toLowerCase(),
          displayName: args.displayName?.trim() || undefined,
          role: "admin",
          status: "active",
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          userId,
          passwordHash: await passwordHashingService.hashPassword(args.password),
          passwordAlgo: passwordHashingService.passwordAlgo,
          updatedAt: nowIso,
        },
      );
      adminResult = "created";
      adminUserId = userId;
    }

    const inviteCodes: string[] = [];
    for (let index = 0; index < args.inviteCount; index += 1) {
      const result = await createAppInvite(
        {
          appInviteRepository,
          now: () => new Date().toISOString(),
        },
        {
          code: args.inviteCodes?.[index],
          roleOnAccept: "viewer",
          maxUses: 1,
        },
      );
      inviteCodes.push(result.code);
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          event: "auth.setup_admin_and_invites.completed",
          admin: {
            email: args.email.trim().toLowerCase(),
            userId: adminUserId,
            result: adminResult,
            role: "admin",
            status: "active",
          },
          invites: inviteCodes,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown_error";
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: "auth.setup_admin_and_invites.failed",
        error: message,
      }),
    );
    process.exitCode = 1;
  });
}
