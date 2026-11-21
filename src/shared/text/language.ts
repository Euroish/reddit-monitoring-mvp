export function detectLanguage(title: string | null, text: string | null): string | null {
  const sample = `${title ?? ""} ${(text ?? "").slice(0, 400)}`.trim();
  if (!sample) return null;
  if (/[\u3040-\u30ff]/u.test(sample)) return "ja";
  if (/[\uac00-\ud7af]/u.test(sample)) return "ko";
  if (/[\u4e00-\u9fff]/u.test(sample)) return "zh";
  if (/[a-zA-Z]{3,}/u.test(sample)) return "en";
  return null;
}

export function detectWebChannel(url: URL, board?: string): string {
  if (board === "bilibili-hot-video") return "bilibili";
  if (board === "google-trends-us") return "google-trends";
  if (board === "huggingface-papers") return "huggingface";
  if (board === "github-trending") return "github";
  if (board === "hackernews") return "hackernews";
  if (board === "v2ex-share") return "v2ex";
  const host = url.hostname.toLowerCase();
  if (host === "www.youtube.com" || host === "youtube.com" || host === "youtu.be") return "youtube";
  if (host === "github.com" || host === "github.blog") return "github";
  if (host === "hnrss.org" || host === "news.ycombinator.com") return "hackernews";
  if (host === "rss.arxiv.org" || host === "arxiv.org") return "arxiv";
  if (host === "huggingface.co") return "huggingface";
  if (host === "www.v2ex.com" || host === "v2ex.com") return "v2ex";
  return "rss";
}
