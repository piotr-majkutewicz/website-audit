import { checkAccessibility } from "./checks/accessibility";
import { checkPerformance } from "./checks/performance";
import { checkSecurity } from "./checks/security";
import { checkSeo } from "./checks/seo";
import { parseHtml, type ParsedHtml } from "./html";
import { dictionary, format, DEFAULT_LANG, type Lang } from "./i18n";
import type { AuditInput, CategoryId, CategoryScore, CheckOutcome, Finding, RawFinding, Report, Severity } from "./types";

export type Check = (input: AuditInput, doc: ParsedHtml) => CheckOutcome;

/** To add a new check module, write a function like the ones in src/checks and add it here. */
export const CHECKS: Check[] = [checkSecurity, checkSeo, checkPerformance, checkAccessibility];

export const PENALTY: Record<Severity, number> = { high: 25, medium: 10, low: 4 };

/** Weights of categories in the overall score. They sum to 100. Names live in src/i18n. */
export const CATEGORIES: { id: CategoryId; weight: number }[] = [
  { id: "security", weight: 25 },
  { id: "seo", weight: 30 },
  { id: "performance", weight: 25 },
  { id: "accessibility", weight: 20 },
];

export function scoreCategory(findings: RawFinding[], id: CategoryId): number {
  const penalty = findings.filter((f) => f.category === id).reduce((sum, f) => sum + PENALTY[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Pure function: same input, same report (except the timestamp, passed in for testing). */
export function analyze(input: AuditInput, now: Date = new Date(), lang: Lang = DEFAULT_LANG): Report {
  const dict = dictionary(lang);
  const doc = parseHtml(input.html);
  const outcomes = CHECKS.map((check) => check(input, doc));
  const raw = outcomes.flatMap((o) => o.findings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // Texts are added only here, from the dictionary of the requested language.
  const findings: Finding[] = raw.map((f) => {
    const text = dict.findings[f.key];
    const detail = text.detail ? format(text.detail, f.params) : undefined;
    return {
      id: f.id,
      category: f.category,
      severity: f.severity,
      title: format(text.title, f.params),
      why: format(text.why, f.params),
      fix: format(text.fix, f.params),
      ...(detail ? { detail } : {}),
    };
  });
  const passed = outcomes.flatMap((o) => o.passed).map((p) => ({ id: p.id, category: p.category, title: dict.passed[p.id] }));

  const categories: CategoryScore[] = CATEGORIES.map((cat) => ({
    id: cat.id,
    name: dict.categories[cat.id],
    score: scoreCategory(raw, cat.id),
  }));
  const totalWeight = CATEGORIES.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(
    CATEGORIES.reduce((s, cat, i) => s + categories[i]!.score * cat.weight, 0) / totalWeight,
  );

  return {
    lang,
    url: input.finalUrl,
    requestedUrl: input.requestedUrl,
    fetchedAt: now.toISOString(),
    score,
    categories,
    findings,
    passed,
    notChecked: dict.notChecked,
    meta: {
      status: input.status,
      responseTimeMs: input.responseTimeMs,
      htmlBytes: input.htmlBytes,
      truncated: input.truncated,
      redirectCount: input.redirectCount,
    },
    disclaimer: dict.disclaimer,
  };
}
