import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH_BYTES = 64;
const PASSWORD_ALGO = "scrypt";

export class PasswordHashingService {
  public readonly passwordAlgo = PASSWORD_ALGO;

  public async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(password, salt, KEY_LENGTH_BYTES)) as Buffer;
    return `${PASSWORD_ALGO}:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
  }

  public async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [algo, saltHex, hashHex] = passwordHash.split(":");
    if (algo !== PASSWORD_ALGO || !saltHex || !hashHex) {
      return false;
    }

    const expected = Buffer.from(hashHex, "hex");
    const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
    if (actual.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(actual, expected);
  }
}
