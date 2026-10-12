import { existsSync } from "node:fs";
import path from "node:path";
import { validateRuntimeEnvironment } from "./environment-config";

/** Explicit shell values always win. Production never implicitly loads development secrets. */
export function loadLocalEnvironment(): string | null {
  if (process.env.LOCAL_ENV_FILE === "none") return null;
  const configured = process.env.LOCAL_ENV_FILE;
  if (!configured && process.env.NODE_ENV === "production") return null;
  const filename = path.resolve(configured || ".env.local");
  if (!existsSync(filename)) {
    if (configured) throw new Error("The configured LOCAL_ENV_FILE does not exist");
    return null;
  }
  process.loadEnvFile(filename);
  return filename;
}

loadLocalEnvironment();
validateRuntimeEnvironment();
