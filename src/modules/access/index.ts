import type { Pool } from "pg";
import { pruneAccountEmail } from "./email-sql";
import { pruneMfaChallenges } from "./mfa-sql";
import { pruneExpiredBrowserSessions } from "./sql";

export { accountEmailProvider, type AccountEmailProvider } from "./email-provider";
export { accountPublicPosts, emailRoutes } from "./email-routes";
export { createLoginThrottle } from "./login-throttle";
export { mfaConfig } from "./mfa-crypto";
export { isPrivilegedWrite, mfaLoginPath, mfaRoutes } from "./mfa-routes";
export { requireRecentMfa } from "./mfa-sql";
export { accessRoutes, accessRoutes as registerAccessModule } from "./routes";
export {
  bootstrapOwner,
  findActor,
  getUserEmailsByIds,
  getUserQuotaRecord,
  getUserRoleStatus,
  listUsersForQuotaSummary,
  pruneExpiredBrowserSessions,
  updateUserQuotaOverride,
  writeAuditLog,
} from "./sql";

export async function pruneAccessArtifacts(pool: Pool) {
  await Promise.all([
    pruneExpiredBrowserSessions(pool),
    pruneAccountEmail(pool),
    pruneMfaChallenges(pool),
  ]);
}
