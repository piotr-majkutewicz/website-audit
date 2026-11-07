/**
 * Minimal XML handling for sitemaps. Workers have no DOM parser, so this is a small
 * well-formedness check (balanced tags, one root element) and a reader for <loc> entries.
 * It is not a full XML validator: it does not check entities, namespaces or schemas.
 */

export interface SitemapInfo {
  /** Well-formed XML. null when the text was cut off and could not be judged. */
  wellFormed: boolean | null;
  kind: "urlset" | "sitemapindex" | "other";
  /** Number of <loc> entries (a lower bound when truncated). */
  count: number;
  /** An entry points to the home page of the site. null when it could not be judged. */
  hasHome: boolean | null;
  truncated: boolean;
}

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;

export function isWellFormedXml(text: string): boolean {
  const stack: string[] = [];
  let roots = 0;
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text))) {
    const between = text.slice(last, m.index);
    last = m.index + m[0].length;
    if (stack.length === 0 && between.trim() !== "") return false; // text outside the root
    if (between.includes("<")) return false; // a stray "<" that is not a tag
    if (m[2] === undefined) continue; // comment, CDATA, processing instruction or doctype
    const closing = m[1] === "/";
    const selfClosing = m[4] === "/";
    const name = m[2];
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      if (stack.length === 0) {
        roots++;
        if (roots > 1) return false;
      }
      if (!selfClosing) stack.push(name);
    }
  }
  const tail = text.slice(last);
  return stack.length === 0 && roots === 1 && !tail.includes("<") && tail.trim() === "";
}

function normalizeForHome(u: URL): string {
  return u.hostname.replace(/^www\./, "").toLowerCase() + (u.pathname === "" ? "/" : u.pathname) + u.search;
}

export function inspectSitemap(text: string, homeUrl: string, truncated: boolean): SitemapInfo {
  const kind = /<urlset[\s>]/i.test(text) ? "urlset" : /<sitemapindex[\s>]/i.test(text) ? "sitemapindex" : "other";
  let home: string | null = null;
  try {
    home = normalizeForHome(new URL(homeUrl));
  } catch {
    home = null;
  }
  let count = 0;
  let hasHome = false;
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    count++;
    if (!hasHome && home) {
      try {
        if (normalizeForHome(new URL(m[1]!)) === home) hasHome = true;
      } catch {
        /* a bad address in the sitemap is simply not the home page */
      }
    }
  }
  return {
    wellFormed: truncated ? null : isWellFormedXml(text),
    kind,
    count,
    // A sitemap index lists other sitemaps, so the home page cannot be judged from it.
    hasHome: kind === "sitemapindex" || truncated ? (hasHome ? true : null) : hasHome,
    truncated,
  };
}
