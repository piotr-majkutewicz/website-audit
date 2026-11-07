import { findAll, metaContent, type ParsedHtml } from "../html";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

export function checkSeo(input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("seo");

  c.check(input.status >= 200 && input.status < 300, "The page returns a successful status code", {
    id: "status",
    severity: "high",
    title: "The page does not return a successful status code",
    why: "Search engines do not index pages that answer with an error, and visitors see an error page.",
    fix: "Make sure this address returns status 200, or audit the correct address.",
    detail: `status ${input.status}`,
  });

  // Title
  const title = doc.title;
  if (!title) {
    c.fail({
      id: "title",
      severity: "high",
      title: "Missing page title",
      why: "The title is the headline shown in search results and in the browser tab. It is one of the strongest on-page signals.",
      fix: "Add a unique <title> of about 30 to 60 characters that names the page and the business.",
    });
  } else {
    c.check(title.length >= 10 && title.length <= 60, "Page title has a good length", {
      id: "title-length",
      severity: "low",
      title: title.length < 10 ? "Page title is very short" : "Page title is long and may be cut off in search results",
      why: "Titles longer than about 60 characters are usually truncated by search engines, and very short ones say too little.",
      fix: "Rewrite the title to about 30 to 60 characters, with the most important words first.",
      detail: `${title.length} characters`,
    });
  }

  // Meta description
  const desc = metaContent(doc, "name", "description");
  if (desc === null || desc.trim() === "") {
    c.fail({
      id: "description",
      severity: "medium",
      title: "Missing meta description",
      why: "Search engines often show it under the title. A clear description gets more clicks.",
      fix: "Add <meta name=\"description\" content=\"...\"> with one or two sentences (about 70 to 160 characters).",
    });
  } else {
    const len = desc.trim().length;
    c.check(len >= 70 && len <= 160, "Meta description has a good length", {
      id: "description-length",
      severity: "low",
      title: len < 70 ? "Meta description is short" : "Meta description is long and may be cut off",
      why: "Descriptions outside roughly 70 to 160 characters are either too thin to persuade or truncated in results.",
      fix: "Rewrite it to a clear summary of about 70 to 160 characters.",
      detail: `${len} characters`,
    });
  }

  // H1
  const h1s = doc.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    c.fail({
      id: "h1",
      severity: "high",
      title: "No H1 heading",
      why: "The H1 tells visitors and search engines what the page is about.",
      fix: "Add exactly one <h1> with the main topic of the page.",
    });
  } else {
    c.check(h1s.length === 1, "Exactly one H1 heading", {
      id: "h1",
      severity: "medium",
      title: "More than one H1 heading",
      why: "Several H1s blur the main topic of the page and confuse screen reader users.",
      fix: "Keep one <h1> and turn the others into <h2> or lower levels.",
      detail: `H1 count: ${h1s.length}`,
    });
  }

  // Canonical
  const canonical = findAll(doc, "link").find((t) => (t.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  c.check(Boolean(canonical?.attrs["href"]), "Canonical link is set", {
    id: "canonical",
    severity: "medium",
    title: "Missing canonical link",
    why: "Without a canonical address, search engines may treat variants of the same page (with tracking parameters, with or without www) as duplicates.",
    fix: "Add <link rel=\"canonical\" href=\"https://your-domain/page\"> pointing to the preferred address.",
  });

  // Viewport
  c.check(Boolean(metaContent(doc, "name", "viewport")), "Viewport meta tag is set", {
    id: "viewport",
    severity: "high",
    title: "Missing viewport meta tag",
    why: "Without it, phones show a zoomed-out desktop layout. Google ranks the mobile version of a page first.",
    fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
  });

  // Open Graph
  const missingOg = ["og:title", "og:description", "og:image"].filter((p) => !metaContent(doc, "property", p));
  c.check(missingOg.length === 0, "Open Graph tags are set", {
    id: "open-graph",
    severity: "low",
    title: "Incomplete Open Graph tags",
    why: "These tags control how the page looks when shared on social networks and in messengers. Without them previews are plain or random.",
    fix: "Add the missing og: meta tags, including an image of about 1200x630 pixels.",
    detail: `missing: ${missingOg.join(", ")}`,
  });

  // Robots / noindex
  const robotsMeta = (metaContent(doc, "name", "robots") ?? "").toLowerCase();
  const xRobots = (input.headers["x-robots-tag"] ?? "").toLowerCase();
  c.check(!/noindex/.test(robotsMeta) && !/noindex/.test(xRobots), "The page is not blocked from indexing", {
    id: "noindex",
    severity: "high",
    title: "The page is marked noindex",
    why: "Search engines will not show this page in results. This is a common leftover from a development phase.",
    fix: "Remove noindex from the robots meta tag or the X-Robots-Tag header if the page should appear in search.",
  });

  // robots.txt and sitemap
  c.check(input.robotsTxt.found, "robots.txt exists", {
    id: "robots-txt",
    severity: "low",
    title: "No robots.txt file",
    why: "robots.txt tells crawlers what to skip and where the sitemap is. Its absence is not an error, but it is standard practice.",
    fix: "Add a /robots.txt file, even a minimal one that allows everything and points to the sitemap.",
  });
  c.check(input.sitemapXml.found || input.robotsTxt.hasSitemapLine, "A sitemap is available", {
    id: "sitemap",
    severity: "low",
    title: "No sitemap.xml found",
    why: "A sitemap helps search engines find all your pages, especially new ones.",
    fix: "Generate /sitemap.xml (most CMS plugins do it) and reference it in robots.txt.",
  });

  return c.result();
}
