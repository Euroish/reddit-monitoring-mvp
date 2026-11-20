import type { Actor, PublicContent } from "../../../packages/contracts/src/source-content.js";
import type { StoryEvidence, StoryFeed } from "../../../packages/contracts/src/content-stories.js";

export type SessionPayload = {
  user: Actor | null;
  publicRead?: boolean;
  publicRegistration?: boolean;
};

export type PublicSourceSummary = {
  id: string;
  label: string;
  platform: string;
  sourceGroup: string | null;
  tier: "T1" | "T1_5" | "T2";
  locale: string | null;
  state: string;
  lastSuccessAt: string | null;
  count48h: number;
};

export type PublicSourcesPayload = {
  sources: PublicSourceSummary[];
  groupCounts: Record<string, number>;
};

export type StoryEvidenceView = StoryEvidence & {
  thumbnail?: string | null;
};

export type StoryItemView = Omit<StoryFeed["items"][number], "representative" | "related"> & {
  representative: StoryEvidenceView;
  related: StoryEvidenceView[];
};

export type StoryFeedPage = Omit<StoryFeed, "items"> & {
  items: StoryItemView[];
  totalCount?: number;
  nextOffset?: number | null;
};

export type ContentFeedPage = {
  items: PublicContent[];
  nextCursor: string | null;
};

export type ReaderPreview = {
  id: string;
  title: string;
  url?: string | null;
  author?: string | null;
  sourceLabel?: string;
  tier?: "T1" | "T1_5" | "T2";
  publishedAt?: string | null;
  discoveredAt?: string;
  excerpt?: string | null;
  thumbnail?: string | null;
  platform?: string;
  related?: StoryEvidenceView[];
};

export type AuthMode = "login" | "register";
export type OpenAuthFn = (mode?: AuthMode, reason?: string) => void;
