/**
 * Small tolerant HTML tokenizer. It is not a full HTML5 parser: it is enough to read
 * tags and attributes for the checks, and it never executes or renders anything.
 */

export interface Tag {
  name: string;
  attrs: Record<string, string>;
  /** Offset of the tag in the source. */
  index: number;
  /** Number of open <label> elements around this tag. */
  labelDepth: number;
}

export interface Heading {
  level: number;
  text: string;
}

export interface ParsedHtml {
  tags: Tag[];
  /** Text of <script type="application/ld+json"> blocks (at most 20, each cut at 200 KB). */
  jsonLd: string[];
  title: string | null;
  headings: Heading[];
}

const RAW_TEXT = new Set(["script", "style", "textarea"]);
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(src))) {
    const name = m[1]!.toLowerCase();
    if (name in attrs) continue; // the first occurrence wins, like in browsers
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseHtml(html: string): ParsedHtml {
  const tags: Tag[] = [];
  const headings: Heading[] = [];
  const jsonLd: string[] = [];
  let title: string | null = null;
  let labelDepth = 0;
  const lower = html.toLowerCase();

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();

    if (closing) {
      if (name === "label" && labelDepth > 0) labelDepth--;
      continue;
    }
    const attrs = parseAttrs(m[3] ?? "");
    tags.push({ name, attrs, index: m.index, labelDepth });
    if (name === "label") labelDepth++;

    const afterTag = m.index + m[0].length;
    if (RAW_TEXT.has(name) || name === "title") {
      const end = lower.indexOf("</" + name, afterTag);
      const stop = end === -1 ? html.length : end;
      if (name === "script" && /ld\+json/i.test(attrs["type"] ?? "") && jsonLd.length < 20) {
        jsonLd.push(html.slice(afterTag, Math.min(stop, afterTag + 200_000)));
      }
      if (name === "title" && title === null) {
        title = decodeEntities(html.slice(afterTag, stop)).replace(/\s+/g, " ").trim();
      }
      TAG_RE.lastIndex = stop;
      continue;
    }
    const hm = /^h([1-6])$/.exec(name);
    if (hm) {
      const close = new RegExp("</h" + hm[1] + "\\s*>", "i");
      const rest = html.slice(afterTag, afterTag + 2000);
      const c = close.exec(rest);
      headings.push({ level: Number(hm[1]), text: stripTags(c ? rest.slice(0, c.index) : rest.slice(0, 200)) });
    }
  }
  return { tags, jsonLd, title, headings };
}

export function findAll(doc: ParsedHtml, name: string): Tag[] {
  return doc.tags.filter((t) => t.name === name);
}

export function metaContent(doc: ParsedHtml, key: string, value: string): string | null {
  for (const t of doc.tags) {
    if (t.name === "meta" && (t.attrs[key] ?? "").toLowerCase() === value) {
      return t.attrs["content"] ?? "";
    }
  }
  return null;
}
