import { CONTENT_PLATFORMS, type ContentPlatform } from "../../packages/contracts/src/source-content";
import { SourceContentError } from "./source-content-error";

export function isContentMetricKey(value: string): boolean {
  const match = /^([a-z]+)\.[a-z0-9_]{1,50}$/.exec(value);
  return Boolean(match && CONTENT_PLATFORMS.includes(match[1] as ContentPlatform));
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireSourceId(value: string): string {
  if (!uuid.test(value)) throw new SourceContentError("Invalid source/job identifier");
  return value;
}
