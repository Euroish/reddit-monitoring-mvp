export type UUID = string;
export type ISODateTime = string;

export type SourceCode = "reddit";

export interface PageCursor {
  after?: string;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetAt?: ISODateTime;
}

