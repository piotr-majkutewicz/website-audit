import { findAll, metaContent, type ParsedHtml } from "../html";
import { inspectJsonLd } from "../jsonld";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

export function checkSeo(input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("seo");

  c.check(input.status >= 200 && input.status < 300, { id: "status", severity: "high", params: { status: input.status } });

  // Title
  const title = doc.title;
  if (!title) {
    c.fail({ id: "title", key: "title.missing", severity: "high" });
  } else {
    c.check(title.length >= 10 && title.length <= 60, {
      id: "title-length",
      key: title.length < 10 ? "title-length.short" : "title-length.long",
      severity: "low",
      params: { length: title.length },
    });
  }

  // Meta description
  const desc = metaContent(doc, "name", "description");
  if (desc === null || desc.trim() === "") {
    c.fail({ id: "description", key: "description.missing", severity: "medium" });
  } else {
    const len = desc.trim().length;
    c.check(len >= 70 && len <= 160, {
      id: "description-length",
      key: len < 70 ? "description-length.short" : "description-length.long",
      severity: "low",
      params: { length: len },
    });
  }

  // H1
  const h1s = doc.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    c.fail({ id: "h1", key: "h1.missing", severity: "high" });
  } else {
    c.check(h1s.length === 1, { id: "h1", key: "h1.multiple", severity: "medium", params: { count: h1s.length } });
  }

  // Canonical
  const canonical = findAll(doc, "link").find((t) => (t.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  c.check(Boolean(canonical?.attrs["href"]), { id: "canonical", severity: "medium" });

  // Viewport
  c.check(Boolean(metaContent(doc, "name", "viewport")), { id: "viewport", severity: "high" });

  // Open Graph
  const missingOg = ["og:title", "og:description", "og:image"].filter((p) => !metaContent(doc, "property", p));
  c.check(missingOg.length === 0, { id: "open-graph", severity: "low", params: { missing: missingOg.join(", ") } });

  // Robots / noindex
  const robotsMeta = (metaContent(doc, "name", "robots") ?? "").toLowerCase();
  const xRobots = (input.headers["x-robots-tag"] ?? "").toLowerCase();
  c.check(!/noindex/.test(robotsMeta) && !/noindex/.test(xRobots), { id: "noindex", severity: "high" });

  // robots.txt and sitemap
  c.check(input.robotsTxt.found, { id: "robots-txt", severity: "low" });
  c.check(input.sitemapXml.found || input.robotsTxt.hasSitemapLine, { id: "sitemap", severity: "low" });

  // robots.txt in more depth: it must not block the whole site and should point to the sitemap.
  if (input.robotsTxt.found) {
    c.check(!input.robotsTxt.blocksAll, { id: "robots-open", key: "robots-blocks-all", severity: "high" });
    c.check(input.robotsTxt.hasSitemapLine, { id: "robots-sitemap", key: "robots-no-sitemap", severity: "low" });
  }

  // sitemap.xml in more depth: valid XML, not empty, and it lists the home page.
  const sm = input.sitemapXml.info;
  if (input.sitemapXml.found && sm) {
    if (sm.wellFormed === false || sm.kind === "other") {
      c.fail({ id: "sitemap-valid", key: "sitemap.invalid", severity: "medium" });
    } else if (sm.count === 0) {
      c.fail({ id: "sitemap-valid", key: "sitemap.empty", severity: "medium" });
    } else if (sm.hasHome === false) {
      c.fail({ id: "sitemap-valid", key: "sitemap.noHome", severity: "low", params: { count: sm.count } });
    } else {
      c.pass("sitemap-valid");
    }
    if (sm.count > 0) c.fact("sitemapUrls", { count: sm.truncated ? `${sm.count}+` : sm.count, kind: sm.kind });
  }

  // Structured data (JSON-LD)
  const ld = inspectJsonLd(doc.jsonLd);
  if (ld.total === 0) {
    c.fail({ id: "structured-data", key: "jsonld.none", severity: "low" });
    c.fact("noStructuredData");
  } else if (ld.invalid > 0) {
    c.fail({ id: "structured-data", key: "jsonld.invalid", severity: "medium", params: { count: ld.invalid, total: ld.total } });
    if (ld.types.length > 0) c.fact("structuredTypes", { types: ld.types.join(", ") });
  } else {
    c.pass("structured-data");
    if (ld.types.length > 0) c.fact("structuredTypes", { types: ld.types.join(", ") });
  }

  // hreflang should agree with the language of the page
  const hreflangs = findAll(doc, "link")
    .filter((t) => (t.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("alternate") && t.attrs["hreflang"])
    .map((t) => t.attrs["hreflang"]!.trim().toLowerCase());
  if (hreflangs.length > 0) {
    const pageLang = (findAll(doc, "html")[0]?.attrs["lang"] ?? "").trim().toLowerCase().split("-")[0] ?? "";
    const primary = hreflangs.map((h) => h.split("-")[0]!);
    c.fact("hreflangCodes", { codes: [...new Set(hreflangs)].slice(0, 8).join(", ") });
    if (pageLang) {
      c.check(primary.includes(pageLang), { id: "hreflang", key: "hreflang.mismatch", severity: "low", params: { lang: pageLang } });
    }
  }

  // Favicon: declared in the page, or found at /favicon.ico
  const declaresIcon = findAll(doc, "link").some((t) => /(^|\s)(shortcut\s+)?icon(\s|$)|apple-touch-icon/i.test(t.attrs["rel"] ?? ""));
  if (declaresIcon) c.pass("favicon");
  else if (input.faviconFile !== null) c.check(input.faviconFile, { id: "favicon", severity: "low" });

  // Redirect chain and the www / non-www versions
  c.fact("redirectsCount", { count: input.redirectCount });
  c.check(input.redirectCount <= 2, {
    id: "redirects",
    key: "redirect-chain",
    severity: input.redirectCount >= 4 ? "medium" : "low",
    params: { count: input.redirectCount },
  });
  if (input.wwwVariant.tested && input.wwwVariant.sameTarget !== null) {
    c.check(input.wwwVariant.sameTarget, { id: "www-canonical", key: "www-split", severity: "medium" });
  }

  // Internal links (a sample)
  const ls = input.linkSample;
  if (ls && ls.checked > 0) {
    c.fact("linksChecked", { checked: ls.checked, total: ls.total });
    const n = ls.broken.length;
    c.check(n === 0, {
      id: "links",
      key: "broken-links",
      severity: n >= 3 ? "high" : "medium",
      params: { count: n, checked: ls.checked, total: ls.total, examples: exampleList(ls.broken) },
    });
  }

  return c.result();
}

/** Up to three "path (status)" examples for the detail line. */
export function exampleList(items: { path: string; status: number }[]): string {
  return items
    .slice(0, 3)
    .map((b) => `${b.path.length > 60 ? b.path.slice(0, 57) + "..." : b.path} (${b.status})`)
    .join(", ");
}
