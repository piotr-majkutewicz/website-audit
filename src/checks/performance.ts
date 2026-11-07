import { findAll, type ParsedHtml } from "../html";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

// These thresholds are rules of thumb, not measurements of real user experience.
const HTML_WARN_BYTES = 200 * 1024;
const HTML_BAD_BYTES = 500 * 1024;
const SLOW_MS = 800;
const VERY_SLOW_MS = 2000;
const MANY_SCRIPTS = 15;
const MANY_STYLESHEETS = 8;
const COMPRESSIBLE_MIN_BYTES = 10 * 1024;

export function checkPerformance(input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("performance");
  const h = input.headers;
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;

  // HTML size
  if (input.truncated) {
    c.fail({
      id: "html-size",
      severity: "high",
      title: "The HTML document is very large",
      why: "The page exceeded the size limit of this tool and was cut off. Huge HTML slows down parsing, especially on phones.",
      fix: "Reduce inline data (embedded images, JSON, styles) and split long pages.",
      detail: `over ${kb(input.htmlBytes)}`,
    });
  } else if (input.htmlBytes > HTML_BAD_BYTES) {
    c.fail({
      id: "html-size",
      severity: "medium",
      title: "The HTML document is large",
      why: "Large HTML takes longer to download and parse, especially on slow mobile connections.",
      fix: "Move inline images and scripts into separate cacheable files and remove unused markup.",
      detail: kb(input.htmlBytes),
    });
  } else {
    c.check(input.htmlBytes <= HTML_WARN_BYTES, "HTML size is reasonable", {
      id: "html-size",
      severity: "low",
      title: "The HTML document is somewhat large",
      why: "The larger the HTML, the longer the first render takes on slow connections.",
      fix: "Check for inline data or repeated markup that could be moved to files or trimmed.",
      detail: kb(input.htmlBytes),
    });
  }

  // Response time
  c.check(input.responseTimeMs <= SLOW_MS, "The server responds quickly", {
    id: "response-time",
    severity: input.responseTimeMs > VERY_SLOW_MS ? "medium" : "low",
    title: input.responseTimeMs > VERY_SLOW_MS ? "The server responds slowly" : "The server response is a bit slow",
    why: "Slow responses delay everything else on the page. Note: this was measured once from a Cloudflare data center, not from your visitors' devices.",
    fix: "Look at hosting quality, caching (page cache or CDN) and slow database queries or plugins.",
    detail: `${input.responseTimeMs} ms`,
  });

  // Compression
  const enc = (h["content-encoding"] ?? "").toLowerCase();
  const compressed = /gzip|br|zstd|deflate/.test(enc);
  c.check(compressed || input.htmlBytes < COMPRESSIBLE_MIN_BYTES, "The HTML is compressed", {
    id: "compression",
    severity: "medium",
    title: "The HTML does not seem to be compressed",
    why: "Compression (gzip or Brotli) usually shrinks HTML by 70 percent or more, which makes pages load noticeably faster.",
    fix: "Enable gzip or Brotli compression on your server or CDN.",
    detail: enc ? `content-encoding: ${enc}` : "no content-encoding header",
  });

  // Cache-Control
  const hasCaching = Boolean(h["cache-control"] || h["etag"] || h["last-modified"] || h["expires"]);
  c.check(hasCaching, "Caching headers are present", {
    id: "cache-control",
    severity: "low",
    title: "No caching headers on the HTML",
    why: "Without Cache-Control, ETag or Last-Modified, browsers and CDNs have no hints for reusing the page, so repeat visits are slower.",
    fix: "Send Cache-Control (for example a short max-age with stale-while-revalidate) and an ETag.",
  });

  // Scripts and stylesheets
  const scripts = findAll(doc, "script").filter((t) => t.attrs["src"]);
  c.check(scripts.length <= MANY_SCRIPTS, "A reasonable number of external scripts", {
    id: "many-scripts",
    severity: "medium",
    title: "Many external scripts",
    why: "Every script is a request and has to be downloaded, parsed and run, which slows the page and blocks interaction on weak phones.",
    fix: "Remove scripts you do not need (old plugins, unused trackers) and bundle the rest.",
    detail: `scripts: ${scripts.length}`,
  });
  const blocking = scripts.filter(
    (t) => !("async" in t.attrs) && !("defer" in t.attrs) && (t.attrs["type"] ?? "").toLowerCase() !== "module",
  );
  c.check(blocking.length === 0, "No render-blocking scripts", {
    id: "blocking-scripts",
    severity: "medium",
    title: "Scripts that block rendering",
    why: "A script without async or defer stops the browser from showing the page until it is downloaded and run.",
    fix: "Add defer (or async) to external scripts, or load them at the end of the page.",
    detail: `scripts: ${blocking.length}`,
  });
  const styles = findAll(doc, "link").filter((t) => (t.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("stylesheet"));
  c.check(styles.length <= MANY_STYLESHEETS, "A reasonable number of stylesheets", {
    id: "many-stylesheets",
    severity: "low",
    title: "Many stylesheets",
    why: "Each stylesheet blocks first render until it is downloaded.",
    fix: "Combine stylesheets and remove unused CSS.",
    detail: `stylesheets: ${styles.length}`,
  });

  // Images
  const imgs = findAll(doc, "img");
  const noSize = imgs.filter((t) => !t.attrs["width"] || !t.attrs["height"]);
  c.check(noSize.length === 0, "Images have width and height", {
    id: "img-dimensions",
    severity: "medium",
    title: "Images without width and height",
    why: "Without dimensions the browser cannot reserve space, so the page jumps while images load (layout shift).",
    fix: "Add width and height attributes to every <img>, matching the image's proportions.",
    detail: `${noSize.length} of ${imgs.length} images`,
  });
  // The first image is usually above the fold and should not be lazy loaded.
  const notLazy = imgs.slice(1).filter((t) => (t.attrs["loading"] ?? "").toLowerCase() !== "lazy");
  c.check(notLazy.length === 0, "Images below the first one use lazy loading", {
    id: "img-lazy",
    severity: "low",
    title: "Images without loading=\"lazy\"",
    why: "Images far down the page are downloaded immediately and compete with content the visitor sees first.",
    fix: "Add loading=\"lazy\" to images that are not visible on first load (but not to the first, main image).",
    detail: `${notLazy.length} of ${Math.max(imgs.length - 1, 0)} images`,
  });

  return c.result();
}
