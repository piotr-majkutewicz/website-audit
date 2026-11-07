import { checkAccessibility } from "./checks/accessibility";
import { checkPerformance } from "./checks/performance";
import { checkSecurity } from "./checks/security";
import { checkSeo } from "./checks/seo";
import { parseHtml, type ParsedHtml } from "./html";
import type { AuditInput, CategoryId, CategoryScore, CheckOutcome, Finding, Report, Severity } from "./types";

export type Check = (input: AuditInput, doc: ParsedHtml) => CheckOutcome;

/** To add a new check module, write a function like the ones in src/checks and add it here. */
export const CHECKS: Check[] = [checkSecurity, checkSeo, checkPerformance, checkAccessibility];

export const PENALTY: Record<Severity, number> = { high: 25, medium: 10, low: 4 };

/** Weights of categories in the overall score. They sum to 100. */
export const CATEGORIES: { id: CategoryId; name: string; weight: number }[] = [
  { id: "security", name: "HTTPS and security headers", weight: 25 },
  { id: "seo", name: "Basic SEO", weight: 30 },
  { id: "performance", name: "Page weight and delivery", weight: 25 },
  { id: "accessibility", name: "Basic accessibility", weight: 20 },
];

export const NOT_CHECKED = [
  "Real performance measurements such as Lighthouse, Core Web Vitals or field data from real visitors.",
  "The quality, accuracy and usefulness of the content, and how well the site sells.",
  "Legal compliance: privacy policy, cookie consent, GDPR, accessibility law.",
  "Application security: vulnerabilities in code, plugins, forms or the server, and the TLS certificate details.",
  "Traffic, rankings, backlinks and anything that needs data from search engines or analytics.",
  "Pages other than the one you entered, and anything that only appears after JavaScript runs.",
];

export const DISCLAIMER =
  "This is an automated, unofficial and simplified check of a single page. It is not a replacement for a full audit and does not come from Google, Lighthouse or any other authority. Treat the score as a conversation starter.";

export function scoreCategory(findings: Finding[], id: CategoryId): number {
  const penalty = findings.filter((f) => f.category === id).reduce((sum, f) => sum + PENALTY[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Pure function: same input, same report (except the timestamp, passed in for testing). */
export function analyze(input: AuditInput, now: Date = new Date()): Report {
  const doc = parseHtml(input.html);
  const outcomes = CHECKS.map((check) => check(input, doc));
  const findings = outcomes.flatMap((o) => o.findings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const passed = outcomes.flatMap((o) => o.passed);

  const categories: CategoryScore[] = CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.name,
    score: scoreCategory(findings, cat.id),
  }));
  const totalWeight = CATEGORIES.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(
    CATEGORIES.reduce((s, cat, i) => s + categories[i]!.score * cat.weight, 0) / totalWeight,
  );

  return {
    url: input.finalUrl,
    requestedUrl: input.requestedUrl,
    fetchedAt: now.toISOString(),
    score,
    categories,
    findings,
    passed,
    notChecked: NOT_CHECKED,
    meta: {
      status: input.status,
      responseTimeMs: input.responseTimeMs,
      htmlBytes: input.htmlBytes,
      truncated: input.truncated,
      redirectCount: input.redirectCount,
    },
    disclaimer: DISCLAIMER,
  };
}
