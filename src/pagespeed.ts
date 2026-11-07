/**
 * Optional measurement with Google PageSpeed Insights (API v5, runPagespeed). It runs Lighthouse
 * on Google's servers, so it is only used when the PAGESPEED_API_KEY secret is set.
 */
import type { ErrorKey } from "./i18n/types";

export const PAGESPEED_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
/** The measurement itself can take around half a minute. */
export const PAGESPEED_TIMEOUT_MS = 45_000;

export interface PagespeedResult {
  strategy: "mobile";
  /** Lighthouse performance score, 0 to 100. */
  score: number | null;
  /** Largest Contentful Paint in milliseconds (lab data). */
  lcpMs: number | null;
  /** Cumulative Layout Shift (unitless, lab data). */
  cls: number | null;
  /** Total Blocking Time in milliseconds (lab data). */
  tbtMs: number | null;
  /** First Contentful Paint in milliseconds (lab data). */
  fcpMs: number | null;
  /** Interaction to Next Paint in milliseconds, 75th percentile of real visits. Often missing. */
  inpMs: number | null;
  /** When Lighthouse ran (from the API). */
  fetchedAt: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Picks the values we show out of the (large) API response. Pure. Returns null when it has no Lighthouse result. */
export function parsePagespeed(json: unknown): PagespeedResult | null {
  const root = json as {
    lighthouseResult?: {
      categories?: { performance?: { score?: unknown } };
      audits?: Record<string, { numericValue?: unknown } | undefined>;
      fetchTime?: unknown;
      runtimeError?: unknown;
    };
    loadingExperience?: { metrics?: { INTERACTION_TO_NEXT_PAINT?: { percentile?: unknown } } };
    analysisUTCTimestamp?: unknown;
  } | null;
  const lh = root?.lighthouseResult;
  if (!lh || lh.runtimeError) return null;
  const score = num(lh.categories?.performance?.score);
  const audit = (id: string) => num(lh.audits?.[id]?.numericValue);
  const result: PagespeedResult = {
    strategy: "mobile",
    score: score === null ? null : Math.round(score * 100),
    lcpMs: audit("largest-contentful-paint"),
    cls: audit("cumulative-layout-shift"),
    tbtMs: audit("total-blocking-time"),
    fcpMs: audit("first-contentful-paint"),
    inpMs: num(root?.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile),
    fetchedAt:
      typeof lh.fetchTime === "string" ? lh.fetchTime : typeof root?.analysisUTCTimestamp === "string" ? root.analysisUTCTimestamp : "",
  };
  return result.score === null && result.lcpMs === null ? null : result;
}

export type PagespeedOutcome = { ok: true; result: PagespeedResult } | { ok: false; status: number; key: ErrorKey };

/** Calls the API. The key is only ever put in the request URL, never in a result or an error. */
export async function runPagespeed(
  url: string,
  apiKey: string,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<PagespeedOutcome> {
  const query = new URLSearchParams({ url, strategy: "mobile", category: "performance", key: apiKey });
  let res: Response;
  try {
    res = await fetchImpl(`${PAGESPEED_ENDPOINT}?${query.toString()}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PAGESPEED_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return { ok: false, status: 504, key: "pagespeed_timeout" };
    }
    return { ok: false, status: 502, key: "pagespeed_unavailable" };
  }
  if (res.status === 429) return { ok: false, status: 429, key: "pagespeed_quota" };
  if (!res.ok) {
    // 400 and 500 with an error body mean Google could not load or measure the page.
    await res.body?.cancel().catch(() => {});
    return { ok: false, status: 502, key: res.status >= 500 || res.status === 400 ? "pagespeed_failed" : "pagespeed_unavailable" };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status: 502, key: "pagespeed_failed" };
  }
  const result = parsePagespeed(json);
  return result ? { ok: true, result } : { ok: false, status: 502, key: "pagespeed_failed" };
}
