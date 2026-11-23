import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { fail } from "../../shared/errors";

const legacy = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const current = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const version = "scrypt:v2:32768:8:3";
export function dummyPasswordHash(stronger = false) {
  return (stronger ? version : "scrypt") + ":" + "0".repeat(32) + ":" + "0".repeat(128);
}
let active = 0;

async function derive(password: string, salt: Buffer, parameters: typeof legacy) {
  if (active >= 2) fail(503, "Authentication temporarily busy");
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    active--;
  }
}

export function isCurrentPasswordHash(hash: string): boolean {
  return hash.startsWith(version + ":");
}

export async function hashPassword(password: string, stronger = false) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, stronger ? current : legacy);
  return [stronger ? version : "scrypt", salt.toString("hex"), key.toString("hex")].join(":");
}

export async function verifyPassword(password: string, hash: string) {
  const match = /^scrypt(:v2:32768:8:3)?:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash);
  if (!match) return false;
  const key = await derive(password, Buffer.from(match[2], "hex"), match[1] ? current : legacy);
  return timingSafeEqual(key, Buffer.from(match[3], "hex"));
}

export async function verifyLoginPassword(password: string, hash: string, balanced: boolean) {
  if (!balanced) return verifyPassword(password, hash);
  const currentHash = isCurrentPasswordHash(hash);
  const legacyMatch = await verifyPassword(password, currentHash ? dummyPasswordHash() : hash);
  const currentMatch = await verifyPassword(password, currentHash ? hash : dummyPasswordHash(true));
  return currentHash ? currentMatch : legacyMatch;
}
