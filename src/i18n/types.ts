import type { CategoryId } from "../types";

export type Lang = "pl" | "en";
export const LANGS: readonly Lang[] = ["pl", "en"];
export const DEFAULT_LANG: Lang = "pl";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Values that can be put into a text template, for example {count} or {kb}. */
export type Params = Record<string, string | number>;

/**
 * Keys of finding texts. A check can have several variants of the same finding
 * (for example a missing title and a title that is too long), each with its own text.
 * The part before the dot is the stable finding id that the API returns.
 */
export const FINDING_KEYS = [
  "https",
  "http-redirect",
  "hsts.missing",
  "hsts.short",
  "csp",
  "xcto",
  "framing",
  "referrer-policy",
  "permissions-policy",
  "mixed-content",
  "status",
  "title.missing",
  "title-length.short",
  "title-length.long",
  "description.missing",
  "description-length.short",
  "description-length.long",
  "h1.missing",
  "h1.multiple",
  "canonical",
  "viewport",
  "open-graph",
  "noindex",
  "robots-txt",
  "sitemap",
  "html-size.truncated",
  "html-size.large",
  "html-size.somewhat",
  "response-time.slow",
  "response-time.verySlow",
  "compression.none",
  "compression.other",
  "cache-control",
  "many-scripts",
  "blocking-scripts",
  "many-stylesheets",
  "img-dimensions",
  "img-lazy",
  "lang.missing",
  "lang.invalid",
  "img-alt",
  "form-labels",
  "heading-order",
] as const;
export type FindingKey = (typeof FINDING_KEYS)[number];

/** Ids of checks that can pass. Same ids as the findings (without the variant). */
export const PASSED_IDS = [
  "https",
  "http-redirect",
  "hsts",
  "csp",
  "xcto",
  "framing",
  "referrer-policy",
  "permissions-policy",
  "mixed-content",
  "status",
  "title-length",
  "description-length",
  "h1",
  "canonical",
  "viewport",
  "open-graph",
  "noindex",
  "robots-txt",
  "sitemap",
  "html-size",
  "response-time",
  "compression",
  "cache-control",
  "many-scripts",
  "blocking-scripts",
  "many-stylesheets",
  "img-dimensions",
  "img-lazy",
  "lang",
  "img-alt",
  "form-labels",
  "heading-order",
] as const;
export type PassedId = (typeof PASSED_IDS)[number];

export const ERROR_KEYS = [
  // Target validation
  "address_empty_or_long",
  "address_invalid",
  "scheme_not_allowed",
  "credentials_not_allowed",
  "port_not_allowed",
  "no_host",
  "ipv6_invalid",
  "ipv6_not_public",
  "ip_not_public",
  "ip_invalid",
  "host_internal",
  // Fetching
  "timeout",
  "unreachable",
  "too_many_redirects",
  "bad_redirect",
  "interrupted",
  // API
  "method_not_allowed",
  "not_found",
  "rate_limited",
  "body_too_large",
  "body_unreadable",
  "invalid_json",
  "url_missing",
  "invalid_lang",
  "internal_error",
] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export const UI_KEYS = [
  "metaTitle",
  "metaDescription",
  "heading",
  "intro",
  "urlLabel",
  "urlPlaceholder",
  "submit",
  "submitBusy",
  "loadingText",
  "loadingSlow",
  "announceLoading",
  "announceDone",
  "errorTimeout",
  "errorHintBlocked",
  "errorHintRate",
  "errorHintSlow",
  "errorHintNetwork",
  "errorHintGeneric",
  "retry",
  "errorGeneric",
  "errorNetwork",
  "reportFor",
  "scoreOutOf",
  "thingsToFix",
  "noProblems",
  "why",
  "fix",
  "passedHeading",
  "notCheckedHeading",
  "severityHigh",
  "severityMedium",
  "severityLow",
  "langSwitchLabel",
  "ctaText",
  "ctaLink",
  "reportLabel",
] as const;
export type UiKey = (typeof UI_KEYS)[number];

export interface FindingText {
  title: string;
  why: string;
  fix: string;
  /** Template for the measured detail, filled from the finding's params. */
  detail?: string;
}

/** The only place with user-facing texts. One dictionary per language (pl.ts, en.ts). */
export interface Dictionary {
  categories: Record<CategoryId, string>;
  findings: Record<FindingKey, FindingText>;
  passed: Record<PassedId, string>;
  notChecked: string[];
  disclaimer: string;
  errors: Record<ErrorKey, string>;
  ui: Record<UiKey, string>;
}

/** Replaces {name} placeholders. A missing parameter leaves the placeholder, which tests catch. */
export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
