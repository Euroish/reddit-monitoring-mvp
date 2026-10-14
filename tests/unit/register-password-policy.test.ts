import assert from "node:assert/strict";
import test from "node:test";
import { registerAppUser, RegisterAppUserError } from "../../src/application/use-cases/register-app-user.use-case";
import { createAppInvite } from "../../src/application/use-cases/create-app-invite.use-case";
import { InMemoryAppInviteRepository, InMemoryAppUserRepository } from "../../src/storage/repositories/in-memory/auth.repositories";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";

test("registration rejects out-of-policy passwords without creating a user or consuming the invitation", async () => {
  const users = new InMemoryAppUserRepository(), invites = new InMemoryAppInviteRepository();
  users.attachInviteRepository(invites);
  const invite = await createAppInvite({ appInviteRepository: invites }, { roleOnAccept: "viewer", maxUses: 1 });
  for (const password of ["x".repeat(11), "x".repeat(129)]) {
    await assert.rejects(registerAppUser({ appUserRepository: users, appInviteRepository: invites }, {
      email: "policy@example.test", password, inviteCode: invite.code,
    }), error => error instanceof RegisterAppUserError && error.code === "invalid_register_request" && !error.message.includes(password));
  }
  assert.equal(await users.findByEmailWithPassword("policy@example.test"), null);
  assert.equal((await invites.findByCodeHash(invite.invite.codeHash))?.usedCount, 0);
});

test("registration accepts both password length boundaries without trimming credentials", async () => {
  const hashes = new PasswordHashingService();
  for (const password of [" twelvechar ", ` ${"x".repeat(126)} `]) {
    const users = new InMemoryAppUserRepository(), invites = new InMemoryAppInviteRepository();
    users.attachInviteRepository(invites);
    const invite = await createAppInvite({ appInviteRepository: invites }, { roleOnAccept: "viewer", maxUses: 1 });
    const user = await registerAppUser({ appUserRepository: users, appInviteRepository: invites }, {
      email: "accepted@example.test", password, inviteCode: invite.code,
    });
    assert.equal(user.status, "pending");
    const record = await users.findByEmailWithPassword(user.email);
    assert.equal(await hashes.verifyPassword(password, record!.password.passwordHash), true);
    assert.equal(await hashes.verifyPassword(password.trim(), record!.password.passwordHash), false);
  }
});
