/**
 * Minimal, dependency-free Markdown renderer for the documentation center.
 * Everything is HTML-escaped first, so only the tags produced here can exist
 * in the output — author-supplied HTML is displayed as text, never executed.
 *
 * Supported: headings, paragraphs (single newline = <br>), bold/italic/inline
 * code, links, bullet & ordered lists (one nesting level), blockquotes,
 * fenced code blocks, pipe tables and horizontal rules.
 */

export interface DocHeading {
  id: string;
  level: number;
  text: string;
}

const CODE_TOKEN = '\u0001';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  if (/^(\/|#)/.test(href)) return href;
  return null;
}

function inline(text: string): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `${CODE_TOKEN}${codes.length - 1}${CODE_TOKEN}`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return match;
    const external = /^https?:/i.test(safe);
    return `<a href="${escapeHtml(safe)}"${external ? ' target="_blank" rel="noreferrer noopener"' : ''}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  out = out.replace(new RegExp(`${CODE_TOKEN}(\\d+)${CODE_TOKEN}`, 'g'), (_m, index: string) => {
    return `<code>${codes[Number(index)]}</code>`;
  });
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return /\|/.test(line) && /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && /-/.test(line);
}

export function renderMarkdown(markdown: string): string {
  const lines = escapeHtml(markdown.replace(/\r\n?/g, '\n')).split('\n');
  const html: string[] = [];
  let headingIndex = 0;
  let listItems: string[] = [];
  let listOrdered = false;
  let quoteLines: string[] = [];
  let paraLines: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listOrdered ? 'ol' : 'ul';
    html.push(`<${tag}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    html.push(`<blockquote>${quoteLines.join('<br>')}</blockquote>`);
    quoteLines = [];
  };
  const flushPara = () => {
    if (!paraLines.length) return;
    html.push(`<p>${paraLines.join('<br>')}</p>`);
    paraLines = [];
  };
  const flushAll = () => {
    flushList();
    flushQuote();
    flushPara();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    const fence = trimmed.match(/^```(\w*)$/);
    if (fence) {
      flushAll();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      html.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length + 1;
      headingIndex += 1;
      html.push(`<h${level} id="doc-h${headingIndex}">${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushAll();
      html.push('<hr>');
      continue;
    }

    if (trimmed.startsWith('&gt;')) {
      flushList();
      flushPara();
      quoteLines.push(inline(trimmed.replace(/^&gt;\s?/, '')));
      continue;
    }
    flushQuote();

    if (trimmed.includes('|') && isTableDivider(lines[i + 1] ?? '')) {
      flushList();
      const head = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push(
        `<div class="doc-table-wrap"><table class="doc-table"><thead><tr>${head
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }

    const item = trimmed.match(/^([-*]|\d+\.)\s+(.*)$/);
    if (item) {
      const ordered = /\d/.test(item[1]);
      if (listItems.length && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push(inline(item[2].trim()));
      continue;
    }

    flushList();
    paraLines.push(inline(trimmed));
  }
  flushAll();
  return html.join('\n');
}

export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  let fence = false;
  let index = 0;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = line.trim().match(/^(#{1,4})\s+(.*)$/);
    if (!match) continue;
    index += 1;
    headings.push({
      id: `doc-h${index}`,
      level: match[1].length + 1,
      text: match[2].replace(/[*`]/g, '').trim(),
    });
  }
  return headings;
}
