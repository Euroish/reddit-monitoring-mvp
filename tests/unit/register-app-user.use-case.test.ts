import assert from "node:assert/strict";
import test from "node:test";
import { registerAppUser, RegisterAppUserError } from "../../src/application/use-cases/register-app-user.use-case";
import { SessionTokenService } from "../../src/application/services/session-token.service";
import type { AppInviteRepository } from "../../src/domain/repositories/app-invite-repository";
import type { AppUserRepository } from "../../src/domain/repositories/app-user-repository";

test("registerAppUser uses atomic registration path without consuming invite on duplicate email race", async () => {
  const tokenService = new SessionTokenService();
  const inviteCode = "invite-token";
  let fallbackConsumed = false;

  const inviteRepository: AppInviteRepository = {
    async create() {
      throw new Error("not used");
    },
    async findByCodeHash(codeHash) {
      assert.equal(codeHash, tokenService.hashToken(inviteCode));
      return {
        id: "11111111-1111-4111-8111-111111111111",
        codeHash,
        status: "active",
        roleOnAccept: "viewer",
        maxUses: 1,
        usedCount: 0,
        expiresAt: undefined,
        createdAt: "2026-04-20T03:00:00.000Z",
      };
    },
    async incrementUsedCountIfAvailable() {
      fallbackConsumed = true;
      return true;
    },
  };

  const userRepository: AppUserRepository = {
    async create() {
      throw new Error("fallback create should not be used");
    },
    async createWithConsumedInvite() {
      return "email_already_registered";
    },
    async findByEmailWithPassword() {
      return null;
    },
    async findById() {
      return null;
    },
    async list() {
      return [];
    },
    async updateStatus() {
      return null;
    },
  };

  await assert.rejects(
    () =>
      registerAppUser(
        {
          appUserRepository: userRepository,
          appInviteRepository: inviteRepository,
          sessionTokenService: tokenService,
          now: () => "2026-04-20T03:00:00.000Z",
        },
        {
          email: "race@example.com",
          password: "password",
          inviteCode,
        },
      ),
    (error) =>
      error instanceof RegisterAppUserError &&
      error.code === "email_already_registered",
  );
  assert.equal(fallbackConsumed, false);
});
