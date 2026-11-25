import { load } from "cheerio";
import sanitize from "sanitize-html";

const NAMED_ENTITY_FALLBACK: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: " ",
  ndash: " ",
  hellip: "...",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
};

/**
 * Decodes HTML5 named and numeric entities safely. Uses cheerio when complex entities
 * or angle brackets are present and falls back to fast regex pass for simple strings.
 */
export function decodeHtmlEntities(raw: string): string {
  if (!raw || !raw.includes("&")) return raw;
  const decoded = load(`<span>${raw.replace(/</g, "&lt;")}</span>`)("span").text();
  if (decoded.includes("&")) {
    return decoded.replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITY_FALLBACK[name.toLowerCase()] ?? m);
  }
  return decoded;
}

const BLOCK_BOUNDARY_TAGS = [
  "address", "article", "aside", "blockquote", "br", "caption", "dd", "div", "dl", "dt",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "ul",
];

/**
 * Extracts clean plain text from HTML/RSS fragments or encoded strings using sanitize-html + cheerio.
 * Skips DOM parsing cleanly when no `<` or `&` markers appear.
 */
export function stripHtmlToPlainText(raw: string | null | undefined): string {
  if (!raw) return "";
  if (!/[<&]/.test(raw)) {
    return raw.replace(/\s+/g, " ").trim();
  }
  // Keep block tags during sanitize-html so <script>/<style> drop cleanly while adjacent cells/paragraphs keep whitespace
  const blockSafe = sanitize(raw, { allowedTags: BLOCK_BOUNDARY_TAGS, allowedAttributes: {} })
    .replace(/<\/?[a-z0-9]+\s*\/?>/gi, " ");
  // Decode HTML5 named & numeric entities (including double-escaped markup) via cheerio
  const firstPass = load(`<span>${blockSafe}</span>`)("span").text();
  const secondPass = /[<&]/.test(firstPass)
    ? load(
        `<span>${sanitize(firstPass, { allowedTags: BLOCK_BOUNDARY_TAGS, allowedAttributes: {} }).replace(/<\/?[a-z0-9]+\s*\/?>/gi, " ")}</span>`,
      )("span").text()
    : firstPass;
  return secondPass.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
