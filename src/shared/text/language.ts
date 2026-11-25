import franc from "franc-min";
import { stripHtmlToPlainText } from "./html";

const ISO639_3_TO_1: Record<string, string> = {
  cmn: "zh",
  zho: "zh",
  jpn: "ja",
  kor: "ko",
  eng: "en",
  spa: "es",
  fra: "fr",
  deu: "de",
  por: "pt",
  ita: "it",
  rus: "ru",
  ara: "ar",
  hin: "hi",
  nld: "nl",
  pol: "pl",
  tur: "tr",
  vie: "vi",
  ind: "id",
  tha: "th",
  swe: "sv",
  ukr: "uk",
  ces: "cs",
  ron: "ro",
  hun: "hu",
  dan: "da",
  fin: "fi",
  nor: "no",
  nob: "no",
  heb: "he",
  ell: "el",
};

const LATIN_WHITELIST = [
  "eng", "spa", "fra", "deu", "por", "ita", "nld", "pol", "tur", "vie", "ind", "swe", "ces", "ron", "hun", "dan", "fin", "nob",
];

function cleanSampleForLanguage(title: string | null, text: string | null): string {
  const combined = `${title ?? ""} ${(text ?? "").slice(0, 600)}`.trim();
  if (!combined) return "";
  return stripHtmlToPlainText(combined)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:^|\s)[@#][a-zA-Z0-9_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Shared short-text & multilingual detector combining unambiguous script fast-paths
 * with franc-min trigram classification (ISO 639-3 -> ISO 639-1).
 */
export function detectLanguage(title: string | null, text: string | null): string | null {
  const sample = cleanSampleForLanguage(title, text);
  if (!sample) return null;

  // Unambiguous CJK / non-Latin scripts first (trigram stats are unreliable on very short headlines)
  if (/[\u3040-\u30ff]/u.test(sample)) return "ja";
  if (/[\uac00-\ud7af]/u.test(sample)) return "ko";
  if (/[\u0600-\u06ff]/u.test(sample)) return "ar";
  if (/[\u0e00-\u0e7f]/u.test(sample)) return "th";

  const hanCount = (sample.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  const latinCount = (sample.match(/[a-zA-Z]/g) ?? []).length;
  if (hanCount >= 2 && hanCount >= latinCount * 0.25) {
    return "zh";
  }
  if (/[\u4e00-\u9fff]/u.test(sample) && latinCount < 4) {
    return "zh";
  }

  if (/[\u0400-\u04ff]/u.test(sample)) {
    const code = franc(sample, { minLength: 10, only: ["rus", "ukr", "bul", "srp"] });
    return ISO639_3_TO_1[code] ?? "ru";
  }

  // Trigram stats on very short pure-ASCII English headlines (< 60 chars) suffer false positives;
  // require either >= 60 chars or non-ASCII Latin diacritics before invoking franc-min.
  const hasLatinDiacritics = /[àâäæçéèêëîïñôöœùûüßãõáíóú¿¡]/iu.test(sample);
  if (sample.length >= 60 || (sample.length >= 24 && hasLatinDiacritics)) {
    const iso3 = franc(sample, { minLength: 10, only: LATIN_WHITELIST });
    if (iso3 !== "und" && ISO639_3_TO_1[iso3]) {
      return ISO639_3_TO_1[iso3];
    }
  }

  // Quick diacritic hints for short non-English Latin titles (< 24 chars)
  if (/[ñáéíóúü¿¡]/iu.test(sample)) return "es";
  if (/[àâçéèêëîïôùûüÿœæ]/iu.test(sample)) return "fr";
  if (/[äöüß]/iu.test(sample)) return "de";
  if (/[ãõç]/iu.test(sample)) return "pt";

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
