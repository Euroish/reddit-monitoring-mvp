export interface CollectionExecutionViolation {
  code: "external_requests_disabled" | "synthetic_mode_forbidden";
  message: string;
}

/** Shared by API admission and worker/CLI creation, before any queue or content write. */
export function collectionExecutionViolation(mode: "live" | "mock" | "demo", env: NodeJS.ProcessEnv = process.env): CollectionExecutionViolation | null {
  if ((mode === "mock" || mode === "demo") && env.NODE_ENV === "production") {
    return {code:"synthetic_mode_forbidden",message:"Synthetic collection is forbidden in production"};
  }
  if (mode === "live" && (env.SOURCE_NETWORK_ENABLED !== "true" || env.SOURCE_RUN_MODE === "demo")) {
    return {code:"external_requests_disabled",message:"External requests disabled by runtime configuration"};
  }
  return null;
}

export function assertCollectionExecutionAllowed(mode: "live" | "mock" | "demo", env: NodeJS.ProcessEnv = process.env): void {
  const violation=collectionExecutionViolation(mode,env);
  if (violation) throw Object.assign(new Error(violation.message),{code:violation.code});
}
