import type { SourceTier, StoryEvidence, StoryItem } from '../../contracts/api';

export interface ReaderPreview {
  id: string;
  title: string;
  url: string | null;
  author: string | null;
  sourceLabel: string;
  tier?: SourceTier;
  publishedAt: string | null;
  discoveredAt?: string;
  excerpt?: string | null;
  thumbnail: string | null;
  platform: string;
  related?: StoryEvidence[];
}

export function storyToReaderPreview(story: StoryItem): ReaderPreview {
  const rep = story.representative;
  return {
    id: rep.id,
    title: rep.title,
    url: rep.url,
    author: rep.author,
    sourceLabel: rep.sourceLabel,
    tier: rep.tier,
    publishedAt: rep.publishedAt,
    discoveredAt: rep.discoveredAt,
    excerpt: story.excerpt,
    thumbnail: rep.thumbnail,
    platform: rep.platform,
    related: story.related,
  };
}

export function evidenceToReaderPreview(ev: StoryEvidence, related?: StoryEvidence[]): ReaderPreview {
  return {
    id: ev.id,
    title: ev.title,
    url: ev.url,
    author: ev.author,
    sourceLabel: ev.sourceLabel,
    tier: ev.tier,
    publishedAt: ev.publishedAt,
    discoveredAt: ev.discoveredAt,
    thumbnail: ev.thumbnail,
    platform: ev.platform,
    related,
  };
}
