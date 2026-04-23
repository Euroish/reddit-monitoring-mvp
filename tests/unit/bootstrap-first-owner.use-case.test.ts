import assert from "node:assert/strict";
import test from "node:test";
import type { AppUser, AppUserPassword } from "../../src/domain/entities/app-user";
import {
  bootstrapFirstOwner,
  BootstrapFirstOwnerError,
  type BootstrapFirstOwnerStore,
} from "../../src/application/use-cases/bootstrap-first-owner.use-case";
import { parseBootstrapFirstOwnerArgs } from "../../scripts/bootstrap-first-owner";

function createStore(): BootstrapFirstOwnerStore & {
  createdUser?: AppUser;
  createdPassword?: AppUserPassword;
} {
  return {
    async hasAnyUsers() {
      return false;
    },
    async findByEmailWithPassword() {
      return null;
    },
    async create(user, password) {
      this.createdUser = user;
      this.createdPassword = password;
    },
  };
}

test("bootstrapFirstOwner creates an active owner on an empty auth store", async () => {
  const store = createStore();

  const user = await bootstrapFirstOwner(
    {
      store,
      now: () => "2026-04-22T12:00:00.000Z",
    },
    {
      email: "Owner@Example.com",
      password: "s3cr3t",
      displayName: "Owner",
    },
  );

  assert.equal(user.email, "owner@example.com");
  assert.equal(user.role, "owner");
  assert.equal(user.status, "active");
  assert.equal(store.createdUser?.email, "owner@example.com");
  assert.equal(store.createdPassword?.userId, user.id);
  assert.ok(store.createdPassword?.passwordHash);
});

test("bootstrapFirstOwner rejects bootstrap when any app user already exists", async () => {
  const store = createStore();
  store.hasAnyUsers = async () => true;

  await assert.rejects(
    () =>
      bootstrapFirstOwner(
        { store },
        {
          email: "owner@example.com",
          password: "s3cr3t",
        },
      ),
    (error: unknown) =>
      error instanceof BootstrapFirstOwnerError &&
      error.code === "owner_bootstrap_not_empty",
  );
});

test("parseBootstrapFirstOwnerArgs reads cli flags and env fallbacks", () => {
  const args = parseBootstrapFirstOwnerArgs(
    ["--email", "owner@example.com", "--password", "secret", "--display-name", "Owner"],
    {},
  );
  const envArgs = parseBootstrapFirstOwnerArgs([], {
    BOOTSTRAP_OWNER_EMAIL: "env@example.com",
    BOOTSTRAP_OWNER_PASSWORD: "env-secret",
    BOOTSTRAP_OWNER_DISPLAY_NAME: "Env Owner",
  });

  assert.deepEqual(args, {
    email: "owner@example.com",
    password: "secret",
    displayName: "Owner",
  });
  assert.deepEqual(envArgs, {
    email: "env@example.com",
    password: "env-secret",
    displayName: "Env Owner",
  });
});
