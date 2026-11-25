import Sentiment from "sentiment";
import { stripHtmlToPlainText } from "./html";
import {
  ZH_INTENSIFIERS,
  ZH_NEGATIVE_TERMS,
  ZH_NEGATORS,
  ZH_POSITIVE_TERMS,
} from "./zh-sentiment-lexicon";

// Direct internal load avoids mutating sentiment's shared global labels object.
import enLabelsRaw from "sentiment/languages/en/labels.json";

export const SENTIMENT_ALGO_VERSION = "afinn_zh_contrast_v2";

const TECH_SENTIMENT_EXTRAS: Record<string, number> = {
  reliable: 2,
  accurate: 2,
  seamless: 3,
  breakthrough: 3,
  affordable: 2,
  cheaper: 2,
  faster: 2,
  fastest: 3,
  intuitive: 2,
  productive: 2,
  works: 1,
  working: 1,
  resolved: 2,
  fixed: 2,
  upgraded: 2,
  upgrade: 1,
  hallucinate: -2,
  hallucination: -2,
  hallucinations: -2,
  buggy: -2,
  crashed: -2,
  crashes: -2,
  crashing: -2,
  slower: -2,
  slowest: -3,
  overpriced: -2,
  useless: -2,
  outage: -3,
  unusable: -3,
  regression: -2,
  downgrade: -2,
  lag: -2,
  laggy: -2,
  freeze: -2,
  frozen: -2,
  inaccurate: -2,
  unstable: -2,
  blocked: -1,
};

const EN_NEGATORS = new Set([
  "not", "no", "never", "dont", "don't", "didnt", "didn't", "doesnt", "doesn't",
  "cant", "can't", "cannot", "isnt", "isn't", "wasnt", "wasn't", "wont", "won't",
  "without", "hardly", "barely", "neither", "nor",
]);

const EN_INTENSIFIERS = new Set([
  "very", "extremely", "super", "really", "so", "incredibly", "totally", "completely", "highly", "much",
]);

const mergedEnLabels: Record<string, number> = {
  ...(enLabelsRaw as Record<string, number>),
  ...TECH_SENTIMENT_EXTRAS,
};

const sentimentAnalyzer = new Sentiment();
sentimentAnalyzer.registerLanguage("en_siftline", {
  labels: mergedEnLabels,
  scoringStrategy: {
    apply(tokens: string[], cursor: number, tokenScore: number) {
      let mult = 1;
      for (let look = Math.max(0, cursor - 2); look < cursor; look++) {
        const w = tokens[look];
        if (EN_NEGATORS.has(w)) mult *= -1;
        else if (EN_INTENSIFIERS.has(w)) mult *= 1.4;
      }
      return tokenScore * mult;
    },
  },
});

const ZH_POS_LIST = [...new Set(ZH_POSITIVE_TERMS)].sort((a, b) => b.length - a.length);
const ZH_NEG_LIST = [...new Set(ZH_NEGATIVE_TERMS)].sort((a, b) => b.length - a.length);
const ZH_POS_SET = new Set(ZH_POS_LIST);
const ZH_NEG_SET = new Set(ZH_NEG_LIST);

/**
 * Splits text around contrastive conjunctions ("but", "however", "但是", "不过", etc.)
 * so post-contrast opinions receive stronger weight than hedged setup clauses.
 */
export function splitContrastiveClauses(text: string): Array<{ text: string; weight: number }> {
  const parts = text
    .split(/(?:\b(?:but|however|although|though|yet|unfortunately|nevertheless|except)\b|但是|但|不过|然而|可惜|只是)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return [{ text, weight: 1 }];
  }
  return parts.map((clause, idx) => ({
    text: clause,
    weight: idx === parts.length - 1 ? 1.4 : 0.6,
  }));
}

function scoreChineseSpans(clause: string): { score: number; hits: number } {
  let score = 0;
  let hits = 0;
  const zhSpans = clause.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const span of zhSpans) {
    // Greedy longest-first scan per character position to avoid double-counting overlapping substrings
    let i = 0;
    while (i < span.length) {
      let matchedTerm = "";
      let matchedPol = 0;
      const maxWin = Math.min(6, span.length - i);
      for (let len = maxWin; len >= 1; len--) {
        const cand = span.slice(i, i + len);
        if (ZH_POS_SET.has(cand)) {
          matchedTerm = cand;
          matchedPol = 1;
          break;
        }
        if (ZH_NEG_SET.has(cand)) {
          matchedTerm = cand;
          matchedPol = -1;
          break;
        }
      }
      if (!matchedTerm) {
        i += 1;
        continue;
      }
      hits++;
      const prefix = span.slice(Math.max(0, i - 3), i);
      let mult = 1;
      if (ZH_NEGATORS.some((neg) => prefix.endsWith(neg))) mult *= -1;
      if (ZH_INTENSIFIERS.some((it) => prefix.includes(it))) mult *= 1.4;
      score += matchedPol * mult;
      i += matchedTerm.length;
    }
  }
  return { score, hits };
}

/**
 * Shared bilingual sentiment analyzer backed by AFINN-165 (`sentiment`),
 * expanded Chinese social/tech lexicon, negation/intensifier windows,
 * and contrastive-clause weighting. Never fabricates polarity when 0 cues match.
 */
export function scoreBilingualSentiment(raw: string | null | undefined): {
  label: "positive" | "neutral" | "negative" | "unclassified";
  score: number;
} {
  const cleaned = stripHtmlToPlainText(raw)
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/gi, " $1 ")
    .replace(/https?:\/\/[^\s)>\]"']+/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return { label: "unclassified", score: 0 };

  const clauses = splitContrastiveClauses(cleaned);
  let totalScore = 0;
  let totalHits = 0;

  for (const { text: clause, weight } of clauses) {
    const enRes = sentimentAnalyzer.analyze(clause, { language: "en_siftline" });
    const enHits = enRes.calculation.length;
    // Scale AFINN [-5..+5] down gently so EN and ZH signals remain balanced
    const enNormalized = enRes.score / 2.2;
    const zhRes = scoreChineseSpans(clause);

    const clauseHits = enHits + zhRes.hits;
    if (clauseHits > 0) {
      totalHits += clauseHits;
      totalScore += (enNormalized + zhRes.score) * weight;
    }
  }

  if (totalHits === 0) {
    return { label: "unclassified", score: 0 };
  }

  const normalized = Math.max(-1, Math.min(1, totalScore / Math.max(1, Math.sqrt(totalHits) * 1.6)));
  const rounded = Number(normalized.toFixed(4));
  if (rounded >= 0.15) return { label: "positive", score: rounded };
  if (rounded <= -0.15) return { label: "negative", score: rounded };
  return { label: "neutral", score: rounded };
}
