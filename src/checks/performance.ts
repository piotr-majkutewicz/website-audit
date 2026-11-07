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
  const kb = (n: number) => Math.round(n / 1024);

  // HTML size
  if (input.truncated) {
    c.fail({ id: "html-size", key: "html-size.truncated", severity: "high", params: { kb: kb(input.htmlBytes) } });
  } else if (input.htmlBytes > HTML_BAD_BYTES) {
    c.fail({ id: "html-size", key: "html-size.large", severity: "medium", params: { kb: kb(input.htmlBytes) } });
  } else {
    c.check(input.htmlBytes <= HTML_WARN_BYTES, {
      id: "html-size",
      key: "html-size.somewhat",
      severity: "low",
      params: { kb: kb(input.htmlBytes) },
    });
  }

  // Response time
  const verySlow = input.responseTimeMs > VERY_SLOW_MS;
  c.check(input.responseTimeMs <= SLOW_MS, {
    id: "response-time",
    key: verySlow ? "response-time.verySlow" : "response-time.slow",
    severity: verySlow ? "medium" : "low",
    params: { ms: input.responseTimeMs },
  });

  // Compression
  const enc = (h["content-encoding"] ?? "").toLowerCase();
  const compressed = /gzip|br|zstd|deflate/.test(enc);
  c.check(compressed || input.htmlBytes < COMPRESSIBLE_MIN_BYTES, {
    id: "compression",
    key: enc ? "compression.other" : "compression.none",
    severity: "medium",
    params: { encoding: enc.slice(0, 40) },
  });

  // Cache-Control
  const hasCaching = Boolean(h["cache-control"] || h["etag"] || h["last-modified"] || h["expires"]);
  c.check(hasCaching, { id: "cache-control", severity: "low" });

  // Scripts and stylesheets
  const scripts = findAll(doc, "script").filter((t) => t.attrs["src"]);
  c.check(scripts.length <= MANY_SCRIPTS, { id: "many-scripts", severity: "medium", params: { count: scripts.length } });
  const blocking = scripts.filter(
    (t) => !("async" in t.attrs) && !("defer" in t.attrs) && (t.attrs["type"] ?? "").toLowerCase() !== "module",
  );
  c.check(blocking.length === 0, { id: "blocking-scripts", severity: "medium", params: { count: blocking.length } });
  const styles = findAll(doc, "link").filter((t) => (t.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("stylesheet"));
  c.check(styles.length <= MANY_STYLESHEETS, { id: "many-stylesheets", severity: "low", params: { count: styles.length } });

  // Images
  const imgs = findAll(doc, "img");
  const noSize = imgs.filter((t) => !t.attrs["width"] || !t.attrs["height"]);
  c.check(noSize.length === 0, { id: "img-dimensions", severity: "medium", params: { count: noSize.length, total: imgs.length } });
  // The first image is usually above the fold and should not be lazy loaded.
  const notLazy = imgs.slice(1).filter((t) => (t.attrs["loading"] ?? "").toLowerCase() !== "lazy");
  c.check(notLazy.length === 0, {
    id: "img-lazy",
    severity: "low",
    params: { count: notLazy.length, total: Math.max(imgs.length - 1, 0) },
  });

  return c.result();
}
