import type { Scopes } from "../../packages/contracts/src/access";

export type Scope = (typeof Scopes)[number];

export type RouteAccessLevel =
  | "public"
  | "public_read"
  | "authenticated"
  | "viewer_write"
  | "admin"
  | "admin_mfa";

export interface DeclarativeRouteAuth {
  /** Minimum access class required for this route. */
  access: RouteAccessLevel;
  /** Optional machine API key scope; omit or set null to deny machine keys. */
  machineScope?: Scope | null;
  /** Allow machine keys without a specific scope (only for discovery endpoints like /v1/capabilities). */
  machineOpen?: boolean;
  /** Requires application/json credential payload validation before DB lookup. */
  credentialSubmission?: boolean;
  /** Disallow Bearer authorization headers (browser-session-only auth endpoints). */
  browserOnly?: boolean;
}

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: DeclarativeRouteAuth;
  }
}
