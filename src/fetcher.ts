/**
 * Network layer. Everything that touches the network lives here, so the analysis
 * code stays pure. `fetchImpl` is injectable so tests can run offline.
 */
import type { ErrorKey } from "./i18n/types";
import { validateTarget } from "./ssrf";
import type { AuditInput } from "./types";

export const LIMITS = {
  maxBytes: 1_500_000,
  auxMaxBytes: 200_000,
  maxRedirects: 5,
  timeoutMs: 8_000,
  /** Upper bound for the whole audit including redirects and helper requests. */
  totalTimeoutMs: 15_000,
};

const USER_AGENT = "website-audit/1.0 (simple site check; unofficial)";

export class AuditError extends Error {
  /** `messageKey` points to the user-facing text in src/i18n. The Error message stays a plain key. */
  constructor(
    readonly code: "blocked_target" | "unreachable" | "timeout" | "too_many_redirects" | "bad_response",
    readonly messageKey: ErrorKey,
  ) {
    super(messageKey);
  }
}

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export interface Fetched {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  redirectCount: number;
  ms: number;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

async function readLimited(res: Response, maxBytes: number, signal: AbortSignal): Promise<{ body: string; bytes: number; truncated: boolean }> {
  if (!res.body) return { body: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(signal.reason ?? new DOMException("Timed out", "TimeoutError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => {}); // avoid an unhandled rejection when the read finishes first
  for (;;) {
    // Race against the deadline so a server that trickles bytes cannot hold the request open.
    const { done, value } = await Promise.race([reader.read(), aborted]).catch(async (e) => {
      await reader.cancel().catch(() => {});
      throw e;
    });
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { body: new TextDecoder().decode(all), bytes: total, truncated };
}

/**
 * GET with manual redirects. Every hop is validated again with validateTarget.
 * With followRedirects=false the first response is returned as is.
 */
export async function fetchChecked(
  startUrl: string,
  fetchImpl: FetchImpl,
  opts: { maxBytes?: number; followRedirects?: boolean; deadline?: number } = {},
): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? LIMITS.maxBytes;
  const follow = opts.followRedirects ?? true;
  const started = Date.now();
  const deadline = opts.deadline ?? started + LIMITS.totalTimeoutMs;
  let current = startUrl;
  let redirects = 0;

  for (;;) {
    const check = validateTarget(current);
    if (!check.ok) throw new AuditError("blocked_target", check.reason);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AuditError("timeout", "timeout");
    const signal = AbortSignal.timeout(Math.min(LIMITS.timeoutMs, remaining));

    let res: Response;
    try {
      res = await fetchImpl(check.url.toString(), {
        method: "GET",
        redirect: "manual",
        // Measured in wrangler dev: without an explicit Accept-Encoding the runtime drops the
        // content-encoding header of the (already decoded) response, so compression would look
        // missing. With it, the header is kept and the body is still delivered decoded.
        // The size limit therefore applies to the decoded body.
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,*/*;q=0.5",
          "accept-encoding": "gzip",
        },
        signal,
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new AuditError("timeout", "timeout");
      }
      throw new AuditError("unreachable", "unreachable");
    }

    const location = res.headers.get("location");
    if (follow && res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      redirects++;
      if (redirects > LIMITS.maxRedirects) {
        throw new AuditError("too_many_redirects", "too_many_redirects");
      }
      let next: string;
      try {
        next = new URL(location, check.url).toString();
      } catch {
        throw new AuditError("bad_response", "bad_redirect");
      }
      current = next;
      continue;
    }

    let read;
    try {
      read = await readLimited(res, maxBytes, signal);
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new AuditError("timeout", "timeout");
      }
      throw new AuditError("unreachable", "interrupted");
    }
    return {
      finalUrl: check.url.toString(),
      status: res.status,
      headers: headersToObject(res.headers),
      ...read,
      redirectCount: redirects,
      ms: Date.now() - started,
    };
  }
}

/** Fetches the page plus the small helper resources and builds the input for analyze(). */
export async function collect(requestedUrl: string, fetchImpl: FetchImpl): Promise<AuditInput> {
  const deadline = Date.now() + LIMITS.totalTimeoutMs;
  const page = await fetchChecked(requestedUrl, fetchImpl, { deadline });
  const final = new URL(page.finalUrl);
  const origin = final.origin;

  const httpTest = async (): Promise<AuditInput["httpRedirect"]> => {
    if (final.protocol !== "https:" || final.port) return null;
    try {
      const r = await fetchChecked(`http://${final.hostname}/`, fetchImpl, { maxBytes: 1, followRedirects: false, deadline });
      return { redirectsToHttps: r.status >= 300 && r.status < 400 && /^https:\/\//i.test(r.headers["location"] ?? "") };
    } catch {
      return null;
    }
  };

  const aux = async (path: string) => {
    try {
      return await fetchChecked(origin + path, fetchImpl, { maxBytes: LIMITS.auxMaxBytes, deadline });
    } catch {
      return null;
    }
  };

  const [httpRedirect, robots, sitemap] = await Promise.all([httpTest(), aux("/robots.txt"), aux("/sitemap.xml")]);

  return buildInput(requestedUrl, page, httpRedirect, robots, sitemap);
}

/** Pure part: turns fetched data into AuditInput. Exported for tests. */
export function buildInput(
  requestedUrl: string,
  page: Fetched,
  httpRedirect: AuditInput["httpRedirect"],
  robots: Fetched | null,
  sitemap: Fetched | null,
): AuditInput {
  const isHtml = (f: Fetched) => /html/i.test(f.headers["content-type"] ?? "");
  const robotsOk = !!robots && robots.status === 200 && !isHtml(robots);
  const sitemapOk = !!sitemap && sitemap.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(sitemap.body);
  return {
    requestedUrl,
    finalUrl: page.finalUrl,
    status: page.status,
    headers: page.headers,
    html: page.body,
    htmlBytes: page.bytes,
    truncated: page.truncated,
    responseTimeMs: page.ms,
    redirectCount: page.redirectCount,
    httpRedirect,
    robotsTxt: { found: robotsOk, hasSitemapLine: robotsOk && /^\s*sitemap:\s*\S+/im.test(robots!.body) },
    sitemapXml: { found: sitemapOk },
  };
}
