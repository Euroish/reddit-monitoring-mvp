import { createHmac } from "node:crypto";

const windowMs = 15 * 60 * 1000;
const maxAccounts = 4096;
const maxAttempts = 10;

export function createLoginThrottle(key: string) {
  const accounts = new Map<string, { expiresAt: number; attempts: number }>();
  return (email: string): number => {
    const now = Date.now();
    const digest = createHmac("sha256", key).update("login-throttle\0").update(email).digest("hex");
    const account = accounts.get(digest);
    if (account && account.expiresAt > now) {
      if (account.attempts >= maxAttempts) return Math.ceil((account.expiresAt - now) / 1000);
      account.attempts++;
      return 0;
    }
    if (account) accounts.delete(digest);
    if (accounts.size >= maxAccounts) {
      for (const [oldest, entry] of accounts) {
        if (entry.expiresAt > now) return Math.ceil((entry.expiresAt - now) / 1000);
        accounts.delete(oldest);
        break;
      }
    }
    accounts.set(digest, { expiresAt: now + windowMs, attempts: 1 });
    return 0;
  };
}
