import { createHash } from "node:crypto";
import type { PublicContentKind } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "./stable-id";

const WEB_IDENTITY_VERSION = "web_content_identity_v1";
const MAX_NAMESPACE_LENGTH = 2048;
const MAX_EXTERNAL_ID_LENGTH = 2048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CONTENT_KINDS: readonly PublicContentKind[] = ["post", "comment", "article", "image", "video"];

export interface WebContentIdentityInput {
  /** Absolute site/feed namespace. It is identity evidence, not permission to fetch this URL. */
  namespace: string;
  /** Preserve the upstream GUID exactly; do not assume that GUIDs are globally unique. */
  externalId: string;
  kind: PublicContentKind;
  /** Opt in only when this publisher treats query-key order as insignificant. Repeated-value order remains stable. */
  sortQueryParameters?: boolean;
}

export interface WebContentIdentity {
  id: string;
  externalId: string;
  extensions: {
    "web.identity_namespace": string;
    "web.raw_external_id": string;
    "web.identity_version": string;
  };
}

export function canonicalWebIdentityNamespace(namespace: string, sortQueryParameters = false): string {
  if (typeof namespace !== "string" || !/^https?:\/\//i.test(namespace) || /\s/.test(namespace) || namespace.length > MAX_NAMESPACE_LENGTH || CONTROL_CHARACTERS.test(namespace) || namespace.includes("\\")) throw new Error("Web identity namespace must be a bounded absolute HTTP(S) URL without whitespace/control characters");
  let url: URL;
  try { url = new URL(namespace); } catch { throw new Error("Web identity namespace must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("Web identity namespace must be an absolute HTTP(S) URL");
  if (url.username || url.password || /^[a-z]+:\/\/[^/?#]*@/i.test(namespace)) throw new Error("Web identity namespace must not contain credentials");
  url.hash = "";
  if (sortQueryParameters) url.searchParams.sort();
  if (url.href.length > MAX_NAMESPACE_LENGTH) throw new Error("Canonical web identity namespace exceeds 2048 characters");
  return url.href;
}

/** Future web adapters must use this identity before persistence; existing legacy IDs are not rewritten. */
export function webContentIdentity(input: WebContentIdentityInput): WebContentIdentity {
  if (!input || typeof input !== "object" || !CONTENT_KINDS.includes(input.kind)) throw new Error("Invalid web content identity kind");
  if (input.sortQueryParameters !== undefined && typeof input.sortQueryParameters !== "boolean") throw new Error("sortQueryParameters must be boolean");
  const namespace = canonicalWebIdentityNamespace(input.namespace, input.sortQueryParameters);
  const rawId = input.externalId;
  if (typeof rawId !== "string" || !rawId.trim() || rawId.length > MAX_EXTERNAL_ID_LENGTH || CONTROL_CHARACTERS.test(rawId)) throw new Error("Web external ID must contain 1–2048 characters without control characters");
  // Some RSS GUIDs are URLs. A URL identity must not preserve embedded credentials as metadata.
  let guidUrl: URL | null = null;
  try { guidUrl = new URL(rawId); } catch { /* An opaque RSS GUID need not be a URL. */ }
  if (guidUrl && (guidUrl.username || guidUrl.password || /^[a-z]+:\/\/[^/?#]*@/i.test(rawId))) throw new Error("Web external ID must not contain URL credentials");
  const qualifiedExternalId = `web:${input.kind}:${createHash("sha256").update(JSON.stringify([namespace, rawId])).digest("hex")}`;
  return {
    id: stableUuidFromString(`web:content:${qualifiedExternalId}`),
    externalId: qualifiedExternalId,
    extensions: { "web.identity_namespace": namespace, "web.raw_external_id": rawId, "web.identity_version": WEB_IDENTITY_VERSION },
  };
}
