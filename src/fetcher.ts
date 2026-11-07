/**
 * Network layer. Everything that touches the network lives here, so the analysis
 * code stays pure. `fetchImpl` is injectable so tests can run offline.
 */
import type { ErrorKey } from "./i18n/types";
import { parseHtml } from "./html";
import { parseRobots } from "./robots";
import { validateTarget } from "./ssrf";
import { extractLinks, extractResources, pickResources, pickSample } from "./sample";
import { inspectSitemap } from "./xml";
import type { AuditInput, ResourceInfo } from "./types";

export const LIMITS = {
  maxBytes: 1_500_000,
  auxMaxBytes: 200_000,
  sitemapMaxBytes: 400_000,
  maxRedirects: 5,
  /** Redirects followed for helper requests such as robots.txt. */
  auxMaxRedirects: 2,
  timeoutMs: 8_000,
  /** Timeout for each probe of a sampled link or file. */
  probeTimeoutMs: 4_000,
  /** Upper bound for the whole audit including redirects and helper requests. */
  totalTimeoutMs: 15_000,
  /**
   * Hard cap on requests to other sites for one audit. The Workers free plan allows 50 subrequests
   * per invocation, so this leaves room. Redirect hops and GET retries count too.
   */
  maxSubrequests: 25,
  maxLinks: 10,
  maxResources: 8,
  /** Probes of links and files in flight at once. */
  probeConcurrency: 5,
  /** Requests in flight at once across the whole audit. */
  maxInFlight: 6,
};

/** Limits how many requests are in flight at once (a Worker can hold 6 open connections). */
export class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly limit: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next(); // the slot passes straight to the next waiter
    else this.active--;
  }
}

/** Counts requests and remembers which hosts were asked. One per audit. */
export class Budget {
  used = 0;
  readonly hosts = new Set<string>();
  constructor(readonly max: number) {}
  /** Returns false when the budget is spent. */
  take(host: string): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    this.hosts.add(host);
    return true;
  }
}

const USER_AGENT = "website-audit/1.0 (simple site check; unofficial)";

export class AuditError extends Error {
  /** `messageKey` points to the user-facing text in src/i18n. The Error message stays a plain key. */
  constructor(
    readonly code: "blocked_target" | "unreachable" | "timeout" | "too_many_redirects" | "bad_response" | "bad_certificate" | "budget",
    readonly messageKey: ErrorKey,
  ) {
    super(messageKey);
  }
}

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export interface Fetched {
  finalUrl: string;
  /** Every Set-Cookie header of the final response. */
  setCookies: string[];
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

/** Messages of failed TLS handshakes differ between runtimes, so this only recognizes common wording. */
const CERT_ERROR_RE = /certif|ssl|tls|handshake|self[- ]signed|x509/i;

/**
 * Request with manual redirects. Every hop is validated again with validateTarget, counted in the
 * budget and limited by the deadline. With followRedirects=false the first response is returned as is.
 */
export async function fetchChecked(
  startUrl: string,
  fetchImpl: FetchImpl,
  opts: {
    maxBytes?: number;
    followRedirects?: boolean;
    deadline?: number;
    method?: "GET" | "HEAD";
    budget?: Budget;
    timeoutMs?: number;
    maxRedirects?: number;
    gate?: Gate;
  } = {},
): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? LIMITS.maxBytes;
  const follow = opts.followRedirects ?? true;
  const maxRedirects = opts.maxRedirects ?? LIMITS.maxRedirects;
  const started = Date.now();
  const deadline = opts.deadline ?? started + LIMITS.totalTimeoutMs;
  let current = startUrl;
  let redirects = 0;

  for (;;) {
    const check = validateTarget(current);
    if (!check.ok) throw new AuditError("blocked_target", check.reason);

    // Wait for a free slot first, so time spent waiting does not count against the request's own timeout.
    await opts.gate?.acquire();
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AuditError("timeout", "timeout");
      if (opts.budget && !opts.budget.take(check.url.hostname)) throw new AuditError("budget", "unreachable");
      const signal = AbortSignal.timeout(Math.min(opts.timeoutMs ?? LIMITS.timeoutMs, remaining));

      let res: Response;
      try {
        res = await fetchImpl(check.url.toString(), {
          method: opts.method ?? "GET",
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
        if (e instanceof Error && CERT_ERROR_RE.test(e.message)) {
          throw new AuditError("bad_certificate", "certificate");
        }
        throw new AuditError("unreachable", "unreachable");
      }

      const location = res.headers.get("location");
      if (follow && res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        redirects++;
        if (redirects > maxRedirects) {
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
        setCookies: typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [],
        status: res.status,
        headers: headersToObject(res.headers),
        ...read,
        redirectCount: redirects,
        ms: Date.now() - started,
      };
    } finally {
      opts.gate?.release();
    }
  }
}

/** Runs fn over items with at most `limit` in flight. Results keep the order of the items. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const siteKey = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * Fetches the page plus a small, bounded set of helper requests and builds the input for analyze().
 * All requests share one budget (LIMITS.maxSubrequests) and one deadline.
 */
export async function collect(requestedUrl: string, fetchImpl: FetchImpl): Promise<AuditInput> {
  const deadline = Date.now() + LIMITS.totalTimeoutMs;
  const budget = new Budget(LIMITS.maxSubrequests);
  const gate = new Gate(LIMITS.maxInFlight);
  const page = await fetchChecked(requestedUrl, fetchImpl, { deadline, budget, gate });
  const final = new URL(page.finalUrl);
  const origin = final.origin;
  const doc = parseHtml(page.body);
  const declaresIcon = doc.tags.some(
    (t) => t.name === "link" && /(^|\s)(shortcut\s+)?icon(\s|$)|apple-touch-icon/i.test(t.attrs["rel"] ?? ""),
  );

  const attempt = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const aux = (url: string, extra: Parameters<typeof fetchChecked>[2] = {}) =>
    attempt(() =>
      fetchChecked(url, fetchImpl, { maxBytes: LIMITS.auxMaxBytes, deadline, budget, gate, maxRedirects: LIMITS.auxMaxRedirects, ...extra }),
    );

  const httpTest = async (): Promise<AuditInput["httpRedirect"]> => {
    if (final.protocol !== "https:" || final.port) return null;
    const r = await aux(`http://${final.hostname}/`, { maxBytes: 1, followRedirects: false });
    if (!r) return null;
    return { redirectsToHttps: r.status >= 300 && r.status < 400 && /^https:\/\//i.test(r.headers["location"] ?? "") };
  };

  const robotsP = aux(origin + "/robots.txt");
  const sitemapP = robotsP.then((robots) => {
    // A sitemap named in robots.txt on the same site wins over the default address.
    let url = origin + "/sitemap.xml";
    if (robots && robots.status === 200) {
      for (const candidate of parseRobots(robots.body).sitemapUrls) {
        try {
          const u = new URL(candidate);
          if ((u.protocol === "https:" || u.protocol === "http:") && siteKey(u.hostname) === siteKey(final.hostname)) {
            url = u.toString();
            break;
          }
        } catch {
          /* ignore an unusable Sitemap line */
        }
      }
    }
    return aux(url, { maxBytes: LIMITS.sitemapMaxBytes });
  });

  const securityTxt = async (): Promise<boolean | null> => {
    const r = await aux(origin + "/.well-known/security.txt", { maxBytes: 4_000 });
    if (!r) return null;
    return r.status === 200 && !/html/i.test(r.headers["content-type"] ?? "") && /^\s*contact\s*:/im.test(r.body);
  };

  const faviconFile = async (): Promise<boolean | null> => {
    if (declaresIcon) return null;
    const r = await probe(origin + "/favicon.ico");
    if (!r) return null;
    return r.status >= 200 && r.status < 300 && !/html/i.test(r.headers["content-type"] ?? "");
  };

  const wwwVariant = async (): Promise<AuditInput["wwwVariant"]> => {
    const host = final.hostname;
    const labels = host.split(".");
    let other: string | null = null;
    if (host.startsWith("www.")) other = host.slice(4);
    else if (labels.length === 2 && !host.startsWith("[")) other = "www." + host;
    if (!other || /^\d+(\.\d+){3}$/.test(other)) return { tested: false, sameTarget: null };
    const r = await aux(`${final.protocol}//${other}/`, { maxBytes: 1, maxRedirects: 3 });
    if (!r || r.status < 200 || r.status >= 300) return { tested: true, sameTarget: null };
    return { tested: true, sameTarget: new URL(r.finalUrl).hostname.toLowerCase() === host.toLowerCase() };
  };

  /** HEAD request that falls back to a one byte GET when the server does not accept HEAD. */
  const probe = async (url: string): Promise<Fetched | null> => {
    const opts = { maxBytes: 1, followRedirects: false, deadline, budget, gate, timeoutMs: LIMITS.probeTimeoutMs } as const;
    return attempt(async () => {
      let r = await fetchChecked(url, fetchImpl, { ...opts, method: "HEAD" });
      if (r.status === 405 || r.status === 501) r = await fetchChecked(url, fetchImpl, { ...opts, method: "GET" });
      return r;
    });
  };

  const sampleLinks = async (): Promise<AuditInput["linkSample"]> => {
    const all = extractLinks(doc, page.finalUrl);
    if (all.length === 0) return null;
    const picked = pickSample(all, LIMITS.maxLinks);
    const results = await mapPool(picked, LIMITS.probeConcurrency, probe);
    const broken: { path: string; status: number }[] = [];
    let checked = 0;
    let unverified = 0;
    results.forEach((r, i) => {
      if (!r) {
        unverified++;
        return;
      }
      checked++;
      if (r.status >= 400 && ![401, 403, 429].includes(r.status)) {
        const u = new URL(picked[i]!);
        broken.push({ path: u.pathname + u.search, status: r.status });
      }
    });
    return { total: all.length, checked, broken, unverified };
  };

  const sampleResources = async (): Promise<AuditInput["resourceSample"]> => {
    const all = extractResources(doc, page.finalUrl);
    if (all.length === 0) return null;
    const picked = pickResources(all, LIMITS.maxResources);
    const results = await mapPool(picked, LIMITS.probeConcurrency, async (c) => ({ c, r: await probe(c.url) }));
    const items: ResourceInfo[] = [];
    for (const { c, r } of results) {
      if (!r) continue;
      const u = new URL(c.url);
      const len = Number(r.headers["content-length"]);
      items.push({
        path: u.pathname + u.search,
        kind: c.kind,
        status: r.status,
        contentType: r.headers["content-type"] ?? "",
        bytes: r.headers["content-length"] !== undefined && Number.isFinite(len) ? len : null,
        cacheControl: r.headers["cache-control"] ?? "",
        hasExpires: Boolean(r.headers["expires"]),
        hasEtag: Boolean(r.headers["etag"]),
      });
    }
    return { total: all.length, items };
  };

  const [httpRedirect, robots, sitemap, sec, fav, www, linkSample, resourceSample] = await Promise.all([
    httpTest(),
    robotsP,
    sitemapP,
    securityTxt(),
    faviconFile(),
    wwwVariant(),
    attempt(sampleLinks),
    attempt(sampleResources),
  ]);

  return buildInput(requestedUrl, page, httpRedirect, robots, sitemap, {
    securityTxt: sec,
    faviconFile: fav,
    wwwVariant: www,
    linkSample,
    resourceSample,
    requests: budget.used,
    hosts: [...budget.hosts],
  });
}

/** Pure part: turns fetched data into AuditInput. Exported for tests. */
export function buildInput(
  requestedUrl: string,
  page: Fetched,
  httpRedirect: AuditInput["httpRedirect"],
  robots: Fetched | null,
  sitemap: Fetched | null,
  extra: Partial<AuditInput> = {},
): AuditInput {
  const isHtml = (f: Fetched) => /html/i.test(f.headers["content-type"] ?? "");
  const robotsOk = !!robots && robots.status === 200 && !isHtml(robots);
  const sitemapOk = !!sitemap && sitemap.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(sitemap.body);
  const robotsInfo = robotsOk ? parseRobots(robots!.body) : null;
  let home = page.finalUrl;
  try {
    home = new URL(page.finalUrl).origin + "/";
  } catch {
    /* keep the page address */
  }
  return {
    requestedUrl,
    finalUrl: page.finalUrl,
    status: page.status,
    headers: page.headers,
    setCookies: page.setCookies,
    html: page.body,
    htmlBytes: page.bytes,
    truncated: page.truncated,
    responseTimeMs: page.ms,
    redirectCount: page.redirectCount,
    httpRedirect,
    robotsTxt: {
      found: robotsOk,
      hasSitemapLine: robotsOk && /^\s*sitemap:\s*\S+/im.test(robots!.body),
      blocksAll: robotsInfo?.blocksAll ?? false,
    },
    sitemapXml: { found: sitemapOk, info: sitemapOk ? inspectSitemap(sitemap!.body, home, sitemap!.truncated) : null },
    securityTxt: null,
    faviconFile: null,
    wwwVariant: { tested: false, sameTarget: null },
    linkSample: null,
    resourceSample: null,
    requests: 0,
    hosts: [],
    ...extra,
  };
}
