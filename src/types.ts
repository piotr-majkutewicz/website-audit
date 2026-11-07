export type Severity = "high" | "medium" | "low";
export type CategoryId = "security" | "seo" | "performance" | "accessibility";

import type { ErrorKey, FindingKey, Lang, Params, PassedId } from "./i18n/types";

/**
 * What the checks produce: stable ids, a text key and parameters. No user-facing text.
 * Texts live in src/i18n and are added by localize() in audit.ts.
 */
export interface RawFinding {
  /** Stable id of the check, for example "img-alt". */
  id: string;
  /** Key of the text variant, for example "title-length.short". */
  key: FindingKey;
  category: CategoryId;
  severity: Severity;
  params: Params;
}

export interface RawPassed {
  id: PassedId;
  category: CategoryId;
}

export interface CheckOutcome {
  findings: RawFinding[];
  passed: RawPassed[];
}

/** Finding as returned by the API: stable id plus texts in the requested language. */
export interface Finding {
  id: string;
  category: CategoryId;
  severity: Severity;
  title: string;
  /** Why this matters. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** Optional measured detail, for example "72 characters". */
  detail?: string;
}

export interface PassedCheck {
  id: string;
  category: CategoryId;
  title: string;
}

export type { ErrorKey, Lang };

/** Everything the pure analysis functions need. No network access happens past this point. */
export interface AuditInput {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  /** Header names are lower case. */
  headers: Record<string, string>;
  html: string;
  /** Bytes actually read from the body (decoded, as seen by the Worker). */
  htmlBytes: number;
  /** True when the body was cut at the size limit. */
  truncated: boolean;
  responseTimeMs: number;
  redirectCount: number;
  /** Result of requesting the plain http:// version. null means not tested. */
  httpRedirect: { redirectsToHttps: boolean } | null;
  robotsTxt: { found: boolean; hasSitemapLine: boolean };
  sitemapXml: { found: boolean };
}

export interface CategoryScore {
  id: CategoryId;
  name: string;
  score: number;
}

export interface Report {
  lang: Lang;
  url: string;
  requestedUrl: string;
  fetchedAt: string;
  score: number;
  categories: CategoryScore[];
  findings: Finding[];
  passed: PassedCheck[];
  notChecked: string[];
  meta: {
    status: number;
    responseTimeMs: number;
    htmlBytes: number;
    truncated: boolean;
    redirectCount: number;
  };
  disclaimer: string;
}
