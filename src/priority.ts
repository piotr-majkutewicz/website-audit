/**
 * How findings are ordered and how their "how we know" line is chosen. Pure data.
 */
import type { BasisKind, FindingKey } from "./i18n/types";
import type { CategoryId, Severity } from "./types";

/** Within one severity, a higher rank (0 to 9) comes first. Based on how much a customer or Google would notice. */
export const IMPACT_RANK: Partial<Record<FindingKey, number>> = {
  https: 9,
  noindex: 9,
  "robots-blocks-all": 9,
  status: 9,
  "http-redirect": 7,
  viewport: 8,
  "title.missing": 7,
  "h1.missing": 6,
  "broken-links": 7,
  "mixed-content": 7,
  "html-size.truncated": 6,
  "img-alt": 5,
  "form-labels": 5,
  "heavy-images": 6,
  "broken-resources": 6,
  "www-split": 6,
  "sitemap.invalid": 5,
  "sitemap.empty": 5,
  "response-time.verySlow": 6,
  "cookies-secure": 5,
  csp: 4,
  "jsonld.invalid": 4,
  "viewport-zoom": 4,
  "description.missing": 4,
  "title-length.short": 3,
  canonical: 3,
};

export const DEFAULT_BASIS: Record<CategoryId, BasisKind> = {
  security: "headers",
  seo: "html",
  performance: "html",
  accessibility: "html",
};

/** Findings whose measurement is not the default of their category. */
export const BASIS_BY_KEY: Partial<Record<FindingKey, BasisKind>> = {
  https: "request",
  "http-redirect": "redirect",
  "mixed-content": "html",
  status: "request",
  noindex: "html",
  "robots-txt": "robots",
  "robots-blocks-all": "robots",
  "robots-no-sitemap": "robots",
  sitemap: "sitemap",
  "sitemap.invalid": "sitemap",
  "sitemap.empty": "sitemap",
  "sitemap.noHome": "sitemap",
  "html-size.truncated": "request",
  "html-size.large": "request",
  "html-size.somewhat": "request",
  "response-time.slow": "request",
  "response-time.verySlow": "request",
  "compression.none": "headers",
  "compression.other": "headers",
  "cache-control": "headers",
  "cookies-secure": "cookies",
  "cookies-httponly": "cookies",
  "cookies-samesite": "cookies",
  "security-txt": "securityTxt",
  "jsonld.none": "jsonld",
  "jsonld.invalid": "jsonld",
  favicon: "favicon",
  "redirect-chain": "redirect",
  "www-split": "variant",
  "broken-links": "links",
  "broken-resources": "resources",
  "heavy-images": "resources",
  "image-formats": "resources",
  "static-cache": "resources",
};

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
