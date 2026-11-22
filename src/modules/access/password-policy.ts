import { fail } from "../../shared/errors";

const commonPasswords = new Set([
  "123456789012345",
  "1234567890123456",
  "passwordpassword",
  "qwertyuiopasdfgh",
  "correcthorsebatterystaple",
  "qwerty1234567890",
  "letmeinletmeinletmein",
  "adminadminadmin",
  "iloveyouiloveyou",
]);

export function checkNewPassword(password: string, email?: string) {
  const normalized = password.normalize("NFKC").toLowerCase();
  const mailbox = email?.split("@")[0];
  if ([...password].length < 15 || Buffer.byteLength(password, "utf8") > 512)
    fail(422, "Use a password of at least 15 characters and at most 512 bytes");
  if (commonPasswords.has(normalized) || /^password[0-9]+$/.test(normalized) ||
    /^(.{1,5})\1+$/u.test(normalized) || (mailbox && normalized === mailbox))
    fail(422, "Choose a less common password");
}
