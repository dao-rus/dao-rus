// Safe presentation-layer Markdown for user-authored text. The source string is stored and
// shared unchanged; this module only turns it into a small AST that React renders as elements.
// Supported: http(s) links (bare and [text](url)), **bold**, *italic*, "- " lists, line breaks.
// Raw HTML, headings, images and every other URL scheme stay plain text.

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "br" }
  | { type: "strong" | "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };
export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; items: InlineNode[][] };

const patterns: Array<{ kind: "link" | "strong" | "em" | "url"; regex: RegExp }> = [
  { kind: "link", regex: /\[([^\]\n]+)\]\(([^()\s]+)\)/ },
  { kind: "strong", regex: /\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*/ },
  { kind: "em", regex: /\*(?=[^\s*])([^*\n]*?[^\s*])\*/ },
  { kind: "url", regex: /https?:\/\/[^\s<>()[\]]+/i },
];
const trailingPunctuation = /[.,;:!?"'»”’]+$/;

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function pushText(nodes: InlineNode[], value: string) {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") last.value += value; else nodes.push({ type: "text", value });
}

function parseInline(source: string, allowLinks = true): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = source;
  while (rest) {
    let best: { kind: string; index: number; match: RegExpExecArray } | null = null;
    for (const { kind, regex } of patterns) {
      if (!allowLinks && (kind === "link" || kind === "url")) continue;
      const match = regex.exec(rest);
      if (match && (!best || match.index < best.index)) best = { kind, index: match.index, match };
    }
    if (!best) { pushText(nodes, rest); break; }
    const { kind, index, match } = best;
    pushText(nodes, rest.slice(0, index));
    let consumed = match[0];
    if (kind === "link") {
      const href = safeHttpUrl(match[2]);
      if (href) nodes.push({ type: "link", href, children: parseInline(match[1], false) });
      else pushText(nodes, match[0]);
    } else if (kind === "url") {
      const url = match[0].replace(trailingPunctuation, "");
      const href = safeHttpUrl(url);
      consumed = url;
      if (href) nodes.push({ type: "link", href, children: [{ type: "text", value: url }] });
      else pushText(nodes, url);
    } else {
      nodes.push({ type: kind as "strong" | "em", children: parseInline(match[1], allowLinks) });
    }
    rest = rest.slice(index + consumed.length);
  }
  return nodes;
}

function parseLines(lines: string[], allowLinks = true): InlineNode[] {
  const nodes: InlineNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ type: "br" });
    nodes.push(...parseInline(line, allowLinks));
  });
  return nodes;
}

export function parseInlineMarkdown(source: string): InlineNode[] {
  return parseLines(source.replace(/\r\n?/g, "\n").trim().split("\n"));
}

const listLine = /^[-*] +(\S.*)$/;

export function parseMarkdown(source: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  let list: InlineNode[][] | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseLines(paragraph) });
    paragraph = [];
  };
  const flushList = () => { if (list) blocks.push({ type: "list", items: list }); list = null; };
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const item = listLine.exec(line.trim());
    if (item) { flushParagraph(); (list ??= []).push(parseInline(item[1])); continue; }
    flushList();
    if (line.trim()) paragraph.push(line.trim()); else flushParagraph();
  }
  flushParagraph(); flushList();
  return blocks;
}
