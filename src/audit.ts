import { checkAccessibility } from "./checks/accessibility";
import { checkPerformance } from "./checks/performance";
import { checkSecurity } from "./checks/security";
import { checkSeo } from "./checks/seo";
import { parseHtml, type ParsedHtml } from "./html";
import { dictionary, format, DEFAULT_LANG, type Lang } from "./i18n";
import { BASIS_BY_KEY, DEFAULT_BASIS, IMPACT_RANK, SEVERITY_ORDER } from "./priority";
import type { Analysis, AnalysisFinding, AuditInput, CategoryId, CheckOutcome, Fact, Finding, RawFinding, Report, Severity } from "./types";

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

/** Pure function: same input, same analysis (except the timestamp, passed in for testing). No texts. */
export function analyzeNeutral(input: AuditInput, now: Date = new Date(), pagespeedAvailable = false): Analysis {
  const doc = parseHtml(input.html);
  const outcomes = CHECKS.map((check) => check(input, doc));
  const raw = outcomes
    .flatMap((o) => o.findings)
    .map((f, i) => ({ f, i }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] ||
        (IMPACT_RANK[b.f.key] ?? 0) - (IMPACT_RANK[a.f.key] ?? 0) ||
        a.i - b.i,
    )
    .map((x) => x.f);

  const findings: AnalysisFinding[] = raw.map((f) => ({
    ...f,
    basis: BASIS_BY_KEY[f.key] ?? DEFAULT_BASIS[f.category],
  }));
  const passed = outcomes.flatMap((o) => o.passed);
  const facts: Fact[] = outcomes.flatMap((o) => o.facts ?? []);

  const categories = CATEGORIES.map((cat) => ({ id: cat.id, score: scoreCategory(raw, cat.id) }));
  const totalWeight = CATEGORIES.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(CATEGORIES.reduce((s, cat, i) => s + categories[i]!.score * cat.weight, 0) / totalWeight);

  return {
    url: input.finalUrl,
    requestedUrl: input.requestedUrl,
    fetchedAt: now.toISOString(),
    score,
    categories,
    findings,
    passed,
    top: findings.slice(0, 3).map((_, i) => i),
    facts,
    coverage: {
      checks: findings.length + passed.length,
      requests: input.requests,
      hosts: input.hosts,
      links: input.linkSample && input.linkSample.checked > 0 ? { checked: input.linkSample.checked, total: input.linkSample.total } : null,
      resources:
        input.resourceSample && input.resourceSample.items.length > 0
          ? { checked: input.resourceSample.items.length, total: input.resourceSample.total }
          : null,
    },
    scoring: {
      weights: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.weight])) as Record<CategoryId, number>,
      penalty: PENALTY,
    },
    meta: {
      status: input.status,
      responseTimeMs: input.responseTimeMs,
      htmlBytes: input.htmlBytes,
      truncated: input.truncated,
      redirectCount: input.redirectCount,
    },
    pagespeedAvailable,
  };
}

/** Adds the texts of one language to an analysis. The page does the same in the browser. */
export function localize(a: Analysis, lang: Lang = DEFAULT_LANG): Report {
  const dict = dictionary(lang);
  const findings: Finding[] = a.findings.map((f) => {
    const text = dict.findings[f.key];
    const detail = text.detail ? format(text.detail, f.params) : undefined;
    return {
      id: f.id,
      category: f.category,
      severity: f.severity,
      title: format(text.title, f.params),
      why: format(text.why, f.params),
      fix: format(text.fix, f.params),
      impact: format(text.impact, f.params),
      basis: format(dict.basis[f.basis], f.params),
      ...(detail ? { detail } : {}),
    };
  });
  return {
    lang,
    url: a.url,
    requestedUrl: a.requestedUrl,
    fetchedAt: a.fetchedAt,
    score: a.score,
    categories: a.categories.map((c) => ({ id: c.id, name: dict.categories[c.id], score: c.score })),
    findings,
    passed: a.passed.map((p) => ({ id: p.id, category: p.category, title: dict.passed[p.id] })),
    notChecked: dict.notChecked,
    top: a.top,
    meta: a.meta,
    coverage: a.coverage,
    pagespeedAvailable: a.pagespeedAvailable,
    disclaimer: dict.disclaimer,
    neutral: a,
  };
}

/** Analysis plus texts in one call. */
export function analyze(input: AuditInput, now: Date = new Date(), lang: Lang = DEFAULT_LANG): Report {
  return localize(analyzeNeutral(input, now), lang);
}
