import type { ISODateTime, RateLimitInfo } from "../../shared/types/common";

export interface ConnectorRequestContext {
  requestId: string;
  now: ISODateTime;
}

export interface RawEnvelope<TPayload = unknown> {
  endpoint: string;
  requestParams: Record<string, string | number | boolean | undefined>;
  httpStatus: number;
  responseHeaders: Record<string, string>;
  payload: TPayload;
  fetchedAt: ISODateTime;
}

export interface ConnectorPage<TPayload = unknown> {
  raw: RawEnvelope<TPayload>;
  nextCursor?: string;
  rateLimit?: RateLimitInfo;
}

export interface SourceConnector<TCollectArgs, TPayload> {
  readonly sourceCode: "reddit";
  collect(args: TCollectArgs, ctx: ConnectorRequestContext): Promise<ConnectorPage<TPayload>>;
  healthCheck(ctx: ConnectorRequestContext): Promise<boolean>;
}

