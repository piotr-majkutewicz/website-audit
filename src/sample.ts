/**
 * Picks links and resources from a page for the sampled checks. Pure functions.
 * Only addresses on the same site (same host, ignoring a leading "www.") are used.
 */
import type { ParsedHtml } from "./html";

export type ResourceKind = "image" | "style" | "script";
export interface Candidate {
  url: string;
  kind: ResourceKind;
}

const MAX_CANDIDATES = 5000;

function siteKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function sameSite(u: URL, base: URL): boolean {
  return (u.protocol === "http:" || u.protocol === "https:") && siteKey(u.hostname) === siteKey(base.hostname);
}

function resolve(href: string | undefined, base: URL): URL | null {
  if (!href) return null;
  const value = href.trim();
  if (!value || value.startsWith("#") || /^(mailto|tel|javascript|data|blob|sms):/i.test(value)) return null;
  try {
    const u = new URL(value, base);
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** Unique same-site links from <a href>, in document order, without the page itself. */
export function extractLinks(doc: ParsedHtml, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const self = new URL(pageUrl);
  self.hash = "";
  const seen = new Set<string>([self.toString()]);
  const out: string[] = [];
  for (const tag of doc.tags) {
    if (tag.name !== "a") continue;
    const u = resolve(tag.attrs["href"], base);
    if (!u || !sameSite(u, base)) continue;
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** Unique same-site images, stylesheets and scripts, in document order. */
export function extractResources(doc: ParsedHtml, pageUrl: string): Candidate[] {
  const base = new URL(pageUrl);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const tag of doc.tags) {
    let href: string | undefined;
    let kind: ResourceKind;
    if (tag.name === "img") {
      href = tag.attrs["src"];
      kind = "image";
    } else if (tag.name === "script") {
      href = tag.attrs["src"];
      kind = "script";
    } else if (tag.name === "link" && (tag.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      href = tag.attrs["href"];
      kind = "style";
    } else continue;
    const u = resolve(href, base);
    if (!u || !sameSite(u, base)) continue;
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, kind });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** Evenly spread, deterministic sample of at most n items, keeping the original order. */
export function pickSample<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return items.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]!);
  return out;
}

/**
 * Chooses the resources to probe: up to `styleAndScript` stylesheets and scripts (kept for the
 * caching check), and images for the rest.
 */
export function pickResources(all: Candidate[], n: number, styleAndScript = 3): Candidate[] {
  const images = all.filter((c) => c.kind === "image");
  const other = pickSample(
    all.filter((c) => c.kind !== "image"),
    Math.min(styleAndScript, n),
  );
  const imagePick = pickSample(images, n - other.length);
  // Fill up with more non-image resources when there are not enough images.
  const rest = n - other.length - imagePick.length;
  const extra =
    rest > 0
      ? all.filter((c) => c.kind !== "image" && !other.includes(c)).slice(0, rest)
      : [];
  return [...imagePick, ...other, ...extra];
}
