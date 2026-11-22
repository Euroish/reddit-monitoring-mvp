import { fail } from "../../shared/errors";

export type AccountEmailPurpose = "register" | "verify" | "reset";

export function accountEmailProvider(env: NodeJS.ProcessEnv, origin: string, request = fetch) {
  if (env.AUTH_EMAIL_ENABLED !== "true") return undefined;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const url = new URL(origin);
  if (!apiKey || !from || !secret || !siteKey || url.protocol !== "https:")
    throw new Error("Account email requires HTTPS, Resend sender and key, and Turnstile keys");
  let sending = 0;
  let verifying = 0;

  return {
    siteKey,
    async verify(token: string, action: AccountEmailPurpose) {
      if (verifying >= 4) fail(503, "Verification temporarily busy");
      verifying++;
      try {
        const response = await request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: new URLSearchParams({ secret, response: token }),
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) fail(503, "Verification temporarily unavailable");
        const result = await response.json() as { success?: boolean; hostname?: string; action?: string; challenge_ts?: string };
        const age = Date.now() - Date.parse(result.challenge_ts ?? "");
        return result.success === true && result.hostname === url.hostname && result.action === action && age >= -30_000 && age <= 300_000;
      } catch {
        fail(503, "Verification temporarily unavailable");
      } finally {
        verifying--;
      }
    },
    async send(to: string, purpose: AccountEmailPurpose, token: string, requestKey: string) {
      if (sending >= 2) return false;
      sending++;
      try {
        const link = new URL("/account/confirm", url.origin);
        link.hash = new URLSearchParams({ purpose, token }).toString();
        const subjects = {
          register: "Create your SIFTLINE account / 创建 SIFTLINE 账户",
          verify: "Verify your SIFTLINE email / 验证 SIFTLINE 邮箱",
          reset: "Reset your SIFTLINE password / 重置 SIFTLINE 密码",
        };
        const response = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": requestKey },
          body: JSON.stringify({
            from, to: [to], subject: subjects[purpose],
            text: `${link.href}\n\nThis link expires in 15 minutes. Ignore this message if you did not request it.\n链接 15 分钟内有效。如非本人操作，请忽略此邮件。`,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      } finally {
        sending--;
      }
    },
  };
}

export type AccountEmailProvider = NonNullable<ReturnType<typeof accountEmailProvider>>;
