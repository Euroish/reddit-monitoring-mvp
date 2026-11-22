import { createPool } from "../../storage/db";
import { decodeTotpSecret, mfaConfig, totpStep } from "./mfa-crypto";
import { provisionMfa } from "./mfa-sql";

async function main() {
  const [operation, userId] = process.argv.slice(2);
  const config = mfaConfig(process.env);
  if (process.argv.length !== 4 || (operation !== "--enroll" && operation !== "--recover") || !config ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId ?? "")) throw new Error("Invalid MFA operation");
  const seed = decodeTotpSecret(process.env.AUTH_MFA_SETUP_SEED ?? "");
  const step = totpStep(seed, process.env.AUTH_MFA_SETUP_CODE ?? "", -1);
  if (step === null) throw new Error("Authenticator confirmation failed");
  const pool = createPool(undefined, 1);
  try {
    await provisionMfa(pool, userId.toLowerCase(), seed, config.key, step, operation === "--recover");
    console.log("Administrator MFA updated");
  } finally {
    seed.fill(0);
    config.key.fill(0);
    await pool.end();
  }
}
if (require.main === module) {
  void main().catch(() => {
    console.error("MFA operation failed. Verify the account, protected configuration and authenticator proof.");
    process.exitCode = 1;
  });
}
