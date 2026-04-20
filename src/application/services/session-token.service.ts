import { createHash, randomBytes } from "node:crypto";

export class SessionTokenService {
  public createToken(): string {
    return randomBytes(32).toString("base64url");
  }

  public hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
