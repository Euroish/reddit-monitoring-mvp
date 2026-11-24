import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export function deriveCredentialKey(sessionSecret: string, env = process.env): Buffer {
  const master = env.CREDENTIALS_MASTER_KEY?.trim() || sessionSecret;
  if (master.length < 16) {
    throw new Error("Credential master key material must have at least 16 characters");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(master, "utf8"),
      Buffer.from("siftline-provider-credentials-v1"),
      Buffer.from("aes-256-gcm"),
      32,
    ),
  );
}

export function encryptCredentialSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptCredentialSecret(payload: string, key: Buffer): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported credential ciphertext format");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 8) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
