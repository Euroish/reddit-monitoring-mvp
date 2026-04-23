import { bootstrapFirstOwner, BootstrapFirstOwnerError } from "../src/application/use-cases/bootstrap-first-owner.use-case";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { PostgresAppUserRepository } from "../src/storage/repositories/postgres/postgres-app-user.repository";

interface BootstrapFirstOwnerCliArgs {
  email: string;
  password: string;
  displayName?: string;
}

export function parseBootstrapFirstOwnerArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
): BootstrapFirstOwnerCliArgs {
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

  return {
    email: parsed.get("email") ?? env.BOOTSTRAP_OWNER_EMAIL ?? "",
    password: parsed.get("password") ?? env.BOOTSTRAP_OWNER_PASSWORD ?? "",
    displayName: parsed.get("display-name") ?? env.BOOTSTRAP_OWNER_DISPLAY_NAME,
  };
}

async function main(): Promise<void> {
  const args = parseBootstrapFirstOwnerArgs(process.argv.slice(2), process.env);
  const db = new PostgresClient();
  const appUserRepository = new PostgresAppUserRepository(db);

  try {
    const user = await bootstrapFirstOwner({
      store: {
        hasAnyUsers: async () => {
          const result = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM app_user");
          return Number(result.rows[0]?.count ?? "0") > 0;
        },
        findByEmailWithPassword: (email) => appUserRepository.findByEmailWithPassword(email),
        create: (user, password) => appUserRepository.create(user, password),
      },
    }, args);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "auth.bootstrap_owner.created",
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      }),
    );
  } catch (error) {
    if (error instanceof BootstrapFirstOwnerError || error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "auth.bootstrap_owner.failed",
          error: error.message,
          code: error instanceof BootstrapFirstOwnerError ? error.code : "bootstrap_owner_failed",
        }),
      );
    }
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  void main();
}
