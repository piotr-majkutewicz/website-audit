import type { SitemapInfo } from "./xml";
import type { BasisKind, ErrorKey, FactKey, FindingKey, Lang, Params, PassedId } from "./i18n/types";

export type Severity = "high" | "medium" | "low";
export type CategoryId = "security" | "seo" | "performance" | "accessibility";

/**
 * What the checks produce: stable ids, a text key and parameters. No user-facing text.
 * Texts live in src/i18n and are added by localize() in audit.ts, or by the page itself.
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

/** A measured fact shown in the report, for example the structured data types that were found. */
export interface Fact {
  id: FactKey;
  params: Params;
}

export interface CheckOutcome {
  findings: RawFinding[];
  passed: RawPassed[];
  facts?: Fact[];
}

/** A finding in the language-neutral view of a report. */
export interface AnalysisFinding extends RawFinding {
  /** How the finding was measured, a key into the "basis" texts. */
  basis: BasisKind;
}

export interface Coverage {
  /** Number of checks that ran (findings plus passed). */
  checks: number;
  /** Requests sent to other sites for this audit. */
  requests: number;
  /** Host names that were requested. */
  hosts: string[];
  /** Sample of internal links: null when links were not checked. */
  links: { checked: number; total: number } | null;
  /** Sample of images, styles and scripts: null when not checked. */
  resources: { checked: number; total: number } | null;
}

/** The report without any user-facing text. The page renders it in either language. */
export interface Analysis {
  url: string;
  requestedUrl: string;
  fetchedAt: string;
  score: number;
  categories: { id: CategoryId; score: number }[];
  findings: AnalysisFinding[];
  passed: RawPassed[];
  /** Indexes into `findings` of the (at most 3) most important things to fix. */
  top: number[];
  facts: Fact[];
  coverage: Coverage;
  scoring: { weights: Record<CategoryId, number>; penalty: Record<Severity, number> };
  meta: {
    status: number;
    responseTimeMs: number;
    htmlBytes: number;
    truncated: boolean;
    redirectCount: number;
  };
  /** True when the optional PageSpeed Insights measurement is switched on for this deployment. */
  pagespeedAvailable: boolean;
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
  /** What it means for the business, in one sentence. */
  impact: string;
  /** How the finding was measured. */
  basis: string;
  /** Optional measured detail, for example "72 characters". */
  detail?: string;
}

export interface PassedCheck {
  id: string;
  category: CategoryId;
  title: string;
}

export type { ErrorKey, Lang, Params };

export interface ResourceInfo {
  /** Path and query of the resource (the host is the audited site). */
  path: string;
  kind: "image" | "style" | "script";
  status: number;
  contentType: string;
  /** Content-Length from the response, null when the server did not send it. */
  bytes: number | null;
  cacheControl: string;
  hasExpires: boolean;
  hasEtag: boolean;
}

/** Everything the pure analysis functions need. No network access happens past this point. */
export interface AuditInput {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  /** Header names are lower case. */
  headers: Record<string, string>;
  /** Every Set-Cookie header of the page response. */
  setCookies: string[];
  html: string;
  /** Bytes actually read from the body (decoded, as seen by the Worker). */
  htmlBytes: number;
  /** True when the body was cut at the size limit. */
  truncated: boolean;
  responseTimeMs: number;
  redirectCount: number;
  /** Result of requesting the plain http:// version. null means not tested. */
  httpRedirect: { redirectsToHttps: boolean } | null;
  robotsTxt: { found: boolean; hasSitemapLine: boolean; blocksAll: boolean };
  /** `info` is set when the sitemap was found and read. */
  sitemapXml: { found: boolean; info: SitemapInfo | null };
  /** /.well-known/security.txt: null means not tested. */
  securityTxt: boolean | null;
  /** /favicon.ico probe, only done when the page declares no icon. null means not probed. */
  faviconFile: boolean | null;
  /** The other host name variant (with or without www). sameTarget null: it did not answer. */
  wwwVariant: { tested: boolean; sameTarget: boolean | null };
  /** Internal links that were probed. null means not tested. */
  linkSample: { total: number; checked: number; broken: { path: string; status: number }[]; unverified: number } | null;
  /** Images, styles and scripts of the same site that were probed. null means not tested. */
  resourceSample: { total: number; items: ResourceInfo[] } | null;
  /** Requests that were sent to other sites and the host names they went to. */
  requests: number;
  hosts: string[];
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
  /** Indexes into `findings` of the most important things to fix. */
  top: number[];
  meta: Analysis["meta"];
  coverage: Coverage;
  pagespeedAvailable: boolean;
  disclaimer: string;
  /** The same report without texts. The page uses it to switch language without a new audit. */
  neutral: Analysis;
}
