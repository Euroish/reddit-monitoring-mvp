import { normalizeAsciiLexeme } from "./normalized-lexemes";

export function normalizeSearchTerm(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
}

export function hasAnySearchTermMatch(text: string, tokens: string[]): boolean {
  const haystack = text.normalize("NFKC").toLowerCase();
  return tokens.some((raw) => {
    const token = normalizeSearchTerm(raw);
    if (!token) return false;
    return /^[a-z0-9_]+$/.test(token)
      ? new RegExp(postgresSearchTermPattern(token), "i").test(haystack)
      : haystack.includes(token);
  });
}

/** PostgreSQL and in-memory queries use the same English word-boundary/plural rules. */
export function postgresSearchTermPattern(raw: string): string {
  const token = normalizeSearchTerm(raw);
  if (!/^[a-z0-9_]+$/.test(token)) return token;
  let stem = normalizeAsciiLexeme(token);
  if (stem.endsWith("ies") && stem.length > 4) stem = `${stem.slice(0, -3)}y`;
  else if (stem.endsWith("es") && stem.length > 4) stem = stem.slice(0, -2);
  else if (stem.endsWith("s") && stem.length > 3) stem = stem.slice(0, -1);
  const variants = [stem, `${stem}s`, `${stem}es`];
  if (stem.endsWith("y")) variants.push(`${stem.slice(0, -1)}ies`);
  return `(^|[^a-z0-9_])(${Array.from(new Set([token, ...variants])).join("|")})($|[^a-z0-9_])`;
}
