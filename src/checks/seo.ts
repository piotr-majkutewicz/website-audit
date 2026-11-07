import { findAll, metaContent, type ParsedHtml } from "../html";
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

  return c.result();
}
