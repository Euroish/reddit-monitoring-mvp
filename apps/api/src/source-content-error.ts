import type { SourceContentError, SourceContentErrorKind } from "../../../src/domain/source-content-error";

const statusByKind = {
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
} as const satisfies Record<SourceContentErrorKind, number>;

/** One transport mapping, shared by source, personal-content and research routes. */
export function sourceContentErrorStatus(error: SourceContentError) {
  return statusByKind[error.kind];
}
