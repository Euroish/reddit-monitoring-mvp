export type SourceContentErrorKind = "invalid_request" | "not_found" | "conflict" | "unavailable";

/** Shared content failure semantics; transport status mapping belongs to the API. */
export class SourceContentError extends Error {
  constructor(message: string, public readonly kind: SourceContentErrorKind = "invalid_request") {
    super(message);
  }
}
