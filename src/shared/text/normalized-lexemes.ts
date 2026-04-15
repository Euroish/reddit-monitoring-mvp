export function normalizeAsciiLexeme(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function extractNormalizedAsciiLexemes(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9_]+/g);
  if (!matches) {
    return [];
  }
  return matches
    .map((value) => normalizeAsciiLexeme(value))
    .filter((value) => value.length > 0);
}

function toLexemeMatchKey(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

export function buildAsciiLexemeMatchSet(text: string): Set<string> {
  const lexemes = extractNormalizedAsciiLexemes(text);
  const values = new Set<string>();
  for (const lexeme of lexemes) {
    values.add(lexeme);
    values.add(toLexemeMatchKey(lexeme));
  }
  return values;
}

export function hasAnyAsciiLexemeMatch(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  const lexemes = buildAsciiLexemeMatchSet(text);
  return tokens.some((token) => lexemes.has(toLexemeMatchKey(normalizeAsciiLexeme(token))));
}

