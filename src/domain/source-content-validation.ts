import { SourceContentError } from "./source-content-error";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireSourceId(value: string): string {
  if (!uuid.test(value)) throw new SourceContentError("Invalid source/job identifier");
  return value;
}
