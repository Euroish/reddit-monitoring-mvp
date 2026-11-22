import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function mfaConfig(env: NodeJS.ProcessEnv) {
  const encoded = env.AUTH_MFA_ENCRYPTION_KEY?.trim();
  const required = env.AUTH_MFA_REQUIRED === "true";
  if (!encoded && !required) return undefined;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded) ||
    [env.SESSION_SECRET, env.CREDENTIALS_MASTER_KEY, env.AUTH_THROTTLE_KEY].some((value) => value?.trim() === encoded))
    throw new Error("AUTH_MFA_ENCRYPTION_KEY must be an independent 32-byte base64url key");
  return { key: Buffer.from(encoded, "base64url"), required };
}

export function decodeTotpSecret(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  if (!/^[A-Z2-7]{32}$/.test(value)) throw new Error("Expected a 20-byte unpadded Base32 TOTP seed");
  const seed = Buffer.alloc(20);
  let bits = 0, accumulator = 0, offset = 0;
  for (const character of value) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      seed[offset++] = (accumulator >> bits) & 255;
    }
  }
  return seed;
}

export function totpStep(seed: Buffer, code: string, lastStep: number, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const center = Math.floor(now / 30_000);
  for (const step of [center - 1, center, center + 1]) {
    if (step <= lastStep) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", seed).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    const expected = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

export function sealTotpSeed(seed: Buffer, key: Buffer, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openTotpSeed(value: string, key: Buffer, userId: string) {
  const sealed = Buffer.from(value, "base64url");
  if (sealed.length !== 48) throw new Error("Invalid encrypted TOTP seed");
  const cipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([cipher.update(sealed.subarray(28)), cipher.final()]);
}
