export type Severity = "high" | "medium" | "low";
export type CategoryId = "security" | "seo" | "performance" | "accessibility";

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

export interface CheckOutcome {
  findings: Finding[];
  passed: PassedCheck[];
}

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
