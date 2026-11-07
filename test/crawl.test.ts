import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/audit";
import { AuditError, Budget, collect, fetchChecked, LIMITS, mapPool, type FetchImpl } from "../src/fetcher";

interface Site {
  /** key: "METHOD url" or "url" for any method */
  routes: Record<string, () => Response>;
}

function mockSite(site: Site) {
  const calls: { method: string; url: string }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const impl: FetchImpl = async (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const route = site.routes[`${method} ${url}`] ?? site.routes[url];
    if (!route) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    return route();
  };
  return { impl, calls, maxInFlight: () => maxInFlight };
}

const html = (body: string, head = "") =>
  new Response(`<!doctype html><html lang="en"><head><title>Shop</title>${head}</head><body><h1>Shop</h1>${body}</body></html>`, {
    headers: { "content-type": "text/html" },
  });
const ok = (type = "text/plain", extra: Record<string, string> = {}) => () => new Response(null, { status: 200, headers: { "content-type": type, ...extra } });
const status = (s: number, headers: Record<string, string> = {}) => () => new Response(null, { status: s, headers });

describe("collect with sampled checks", () => {
  it("probes links and files, finds broken ones and counts every request", async () => {
    const { impl, calls } = mockSite({
      routes: {
        "https://shop.example/": () =>
          html(
            `<a href="/ok">ok</a><a href="/gone">gone</a><a href="/old">old</a><a href="https://other.example/x">other</a>
             <img src="/img/a.jpg" width="1" height="1" alt="a"><img src="/img/b.webp" alt="b"><img src="/img/missing.png" alt="c">`,
            `<link rel="stylesheet" href="/s.css"><link rel="icon" href="/f.png">`,
          ),
        "https://shop.example/ok": ok("text/html"),
        "https://shop.example/gone": status(404),
        "https://shop.example/old": status(301, { location: "http://127.0.0.1/admin" }),
        "https://shop.example/img/a.jpg": ok("image/jpeg", { "content-length": "500000", "cache-control": "max-age=60" }),
        "https://shop.example/img/b.webp": ok("image/webp", { "content-length": "20000", "cache-control": "max-age=31536000" }),
        "https://shop.example/img/missing.png": status(404),
        "https://shop.example/s.css": ok("text/css", { "content-length": "900" }),
        "https://shop.example/robots.txt": () => new Response("User-agent: *\nDisallow: /private\n", { headers: { "content-type": "text/plain" } }),
        "https://shop.example/sitemap.xml": () => new Response("<urlset><url><loc>https://shop.example/</loc></url></urlset>", { headers: { "content-type": "application/xml" } }),
        "https://shop.example/.well-known/security.txt": () => new Response("Contact: mailto:a@shop.example\n", { headers: { "content-type": "text/plain" } }),
        "http://shop.example/": status(301, { location: "https://shop.example/" }),
      },
    });
    const input = await collect("https://shop.example/", impl);

    expect(input.linkSample).toMatchObject({ total: 3, checked: 3, unverified: 0 });
    expect(input.linkSample!.broken).toEqual([{ path: "/gone", status: 404 }]);
    // The redirect to an internal address was neither followed nor requested.
    expect(calls.some((c) => c.url.includes("127.0.0.1"))).toBe(false);
    // Links to other sites were not probed.
    expect(calls.some((c) => c.url.includes("other.example"))).toBe(false);
    expect(input.resourceSample!.total).toBe(4);
    const byPath = Object.fromEntries(input.resourceSample!.items.map((r) => [r.path, r]));
    expect(byPath["/img/a.jpg"]).toMatchObject({ kind: "image", status: 200, bytes: 500000, cacheControl: "max-age=60" });
    expect(byPath["/img/missing.png"]!.status).toBe(404);
    expect(byPath["/s.css"]).toMatchObject({ kind: "style", bytes: 900 });
    expect(input.securityTxt).toBe(true);
    expect(input.faviconFile).toBeNull(); // the page declares an icon, /favicon.ico was not requested
    expect(calls.some((c) => c.url.endsWith("/favicon.ico"))).toBe(false);
    expect(input.sitemapXml.info).toMatchObject({ wellFormed: true, count: 1, hasHome: true });
    expect(input.requests).toBe(calls.length);
    expect(input.hosts).toEqual(expect.arrayContaining(["shop.example"]));
    expect(input.hosts.every((h) => h.endsWith("shop.example"))).toBe(true);
    // Everything but the page itself uses HEAD for the sample.
    expect(calls.filter((c) => c.method === "HEAD").length).toBe(7);

    const report = analyze(input, new Date(), "en");
    expect(report.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["links", "resources"]));
    expect(report.coverage).toMatchObject({ requests: calls.length, links: { checked: 3, total: 3 }, resources: { checked: 4, total: 4 } });
  });

  it("never sends more requests than the budget, however many links and images the page has", async () => {
    const links = Array.from({ length: 300 }, (_, i) => `<a href="/p${i}">p</a>`).join("");
    const imgs = Array.from({ length: 300 }, (_, i) => `<img src="/i${i}.jpg" alt="">`).join("");
    const { impl, calls, maxInFlight } = mockSite({
      routes: { "https://big.example/": () => html(links + imgs), "https://big.example/robots.txt": status(404) },
    });
    const input = await collect("https://big.example/", impl);
    expect(calls.length).toBeLessThanOrEqual(LIMITS.maxSubrequests);
    expect(input.requests).toBe(calls.length);
    expect(input.linkSample!.total).toBe(300);
    expect(input.linkSample!.checked + input.linkSample!.unverified).toBeLessThanOrEqual(LIMITS.maxLinks);
    expect(input.resourceSample!.items.length).toBeLessThanOrEqual(LIMITS.maxResources);
    expect(maxInFlight()).toBeLessThanOrEqual(LIMITS.maxInFlight);
  });

  it("uses the budget as a hard cap even when helper requests redirect a lot", async () => {
    let n = 0;
    const calls: string[] = [];
    const impl: FetchImpl = async (url) => {
      calls.push(url);
      if (url === "https://r.example/") return html(Array.from({ length: 50 }, (_, i) => `<a href="/p${i}">x</a>`).join(""));
      return new Response(null, { status: 301, headers: { location: `https://r.example/hop${n++}` } });
    };
    await collect("https://r.example/", impl);
    expect(calls.length).toBeLessThanOrEqual(LIMITS.maxSubrequests);
  });

  it("falls back to a one byte GET when a server refuses HEAD, and counts it", async () => {
    const { impl, calls } = mockSite({
      routes: {
        "https://h.example/": () => html(`<a href="/a">a</a>`),
        "HEAD https://h.example/a": status(405),
        "GET https://h.example/a": ok("text/html"),
      },
    });
    const input = await collect("https://h.example/", impl);
    expect(calls.filter((c) => c.url.endsWith("/a")).map((c) => c.method)).toEqual(["HEAD", "GET"]);
    expect(input.linkSample).toMatchObject({ checked: 1, broken: [] });
    expect(input.requests).toBe(calls.length);
  });

  it("does not count bot blocks as broken links and reports unreachable probes as unverified", async () => {
    const impl: FetchImpl = async (url, init) => {
      if (url === "https://b.example/") return html(`<a href="/x">x</a><a href="/y">y</a><a href="/z">z</a>`);
      if (url.endsWith("/x")) return new Response(null, { status: 403 });
      if (url.endsWith("/y")) throw new TypeError("fetch failed");
      void init;
      return new Response(null, { status: 500 });
    };
    const input = await collect("https://b.example/", impl);
    expect(input.linkSample).toMatchObject({ total: 3, checked: 2, unverified: 1 });
    expect(input.linkSample!.broken).toEqual([{ path: "/z", status: 500 }]);
  });

  it("gives each probe its own time limit", async () => {
    const original = AbortSignal.timeout;
    AbortSignal.timeout = () => original.call(AbortSignal, 30);
    try {
      const impl: FetchImpl = (url, init) => {
        if (url === "https://slow.example/") return Promise.resolve(html(`<a href="/a">a</a><a href="/b">b</a>`));
        return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))));
      };
      const t = Date.now();
      const input = await collect("https://slow.example/", impl);
      expect(Date.now() - t).toBeLessThan(2000);
      expect(input.linkSample).toMatchObject({ checked: 0, unverified: 2 });
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it("stops probing when the overall deadline has passed", async () => {
    const saved = LIMITS.totalTimeoutMs;
    LIMITS.totalTimeoutMs = 150;
    try {
      const { impl, calls } = mockSite({ routes: { "https://d.example/": () => html(Array.from({ length: 10 }, (_, i) => `<a href="/p${i}">p</a>`).join("")) } });
      const slow: FetchImpl = (u, i) => {
        if (u === "https://d.example/") return impl(u, i);
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(impl(u, i)), 120);
          i.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("t", "TimeoutError"));
          });
        });
      };
      const input = await collect("https://d.example/", slow);
      expect(input.linkSample!.checked).toBeLessThan(10);
      expect(calls.length).toBeLessThan(25);
    } finally {
      LIMITS.totalTimeoutMs = saved;
    }
  });

  it("captures every Set-Cookie header of the page", async () => {
    const headers = new Headers({ "content-type": "text/html" });
    headers.append("set-cookie", "a=1; Secure; HttpOnly");
    headers.append("set-cookie", "b=2");
    const impl: FetchImpl = async (u) => (u === "https://c.example/" ? new Response("<html lang=en><title>x</title></html>", { headers }) : new Response(null, { status: 404 }));
    const input = await collect("https://c.example/", impl);
    expect(input.setCookies).toEqual(["a=1; Secure; HttpOnly", "b=2"]);
  });

  it("follows the sitemap named in robots.txt on the same site, and only there", async () => {
    const run = async (line: string) => {
      const { impl, calls } = mockSite({
        routes: {
          "https://m.example/": () => html(""),
          "https://m.example/robots.txt": () => new Response(`User-agent: *\n${line}\n`, { headers: { "content-type": "text/plain" } }),
          "https://m.example/maps/main.xml": () => new Response("<urlset><url><loc>https://m.example/</loc></url></urlset>", { headers: { "content-type": "application/xml" } }),
        },
      });
      const input = await collect("https://m.example/", impl);
      return { input, calls };
    };
    const own = await run("Sitemap: https://m.example/maps/main.xml");
    expect(own.input.sitemapXml.found).toBe(true);
    expect(own.calls.some((c) => c.url.endsWith("/sitemap.xml"))).toBe(false);
    const foreign = await run("Sitemap: https://evil.example/s.xml\nSitemap: http://127.0.0.1/s.xml");
    expect(foreign.calls.some((c) => c.url.includes("evil.example") || c.url.includes("127.0.0.1"))).toBe(false);
    expect(foreign.calls.some((c) => c.url === "https://m.example/sitemap.xml")).toBe(true);
  });

  it("reads a large sitemap that was cut off without calling it invalid", async () => {
    const big = "<urlset>" + Array.from({ length: 30_000 }, (_, i) => `<url><loc>https://t.example/p/${i}</loc></url>`).join("") + "</urlset>";
    const { impl } = mockSite({
      routes: { "https://t.example/": () => html(""), "https://t.example/sitemap.xml": () => new Response(big, { headers: { "content-type": "application/xml" } }) },
    });
    const input = await collect("https://t.example/", impl);
    expect(input.sitemapXml.info!.truncated).toBe(true);
    expect(input.sitemapXml.info!.wellFormed).toBeNull();
    expect(input.sitemapXml.info!.count).toBeGreaterThan(1000);
  });
});

describe("www and non-www", () => {
  const run = async (variant: () => Response | Promise<Response>, page = "https://example.com/") => {
    const impl: FetchImpl = async (u) => {
      if (u === page) return html("");
      if (u === "https://www.example.com/") return variant();
      if (u === "https://example.com/") return variant();
      return new Response(null, { status: 404 });
    };
    return (await collect(page, impl)).wwwVariant;
  };
  it("is fine when the other version redirects to this one", async () => {
    expect(await run(() => new Response(null, { status: 301, headers: { location: "https://example.com/" } }))).toEqual({ tested: true, sameTarget: true });
  });
  it("flags two separate sites", async () => {
    expect(await run(() => html("copy"))).toEqual({ tested: true, sameTarget: false });
  });
  it("makes no claim when the other version does not answer", async () => {
    expect(await run(() => Promise.reject(new TypeError("fetch failed")))).toEqual({ tested: true, sameTarget: null });
    expect(await run(() => new Response(null, { status: 500 }))).toEqual({ tested: true, sameTarget: null });
  });
  it("also works from the www version and skips hosts where it cannot tell", async () => {
    const seen: string[] = [];
    const impl: FetchImpl = async (u) => {
      seen.push(u);
      return u === "https://www.example.com/" ? html("") : new Response(null, { status: 301, headers: { location: "https://www.example.com/" } });
    };
    expect((await collect("https://www.example.com/", impl)).wwwVariant).toEqual({ tested: true, sameTarget: true });
    expect(seen).toContain("https://example.com/");
    const sub = await collect("https://shop.example.co.uk/", async () => html(""));
    expect(sub.wwwVariant.tested).toBe(false);
    const ip = await collect("https://93.184.216.34/", async () => html(""));
    expect(ip.wwwVariant.tested).toBe(false);
  });
});

describe("certificate problems", () => {
  it("are reported as their own error, not as a generic network error", async () => {
    for (const message of ["certificate has expired", "SSL handshake failed", "TLS error: self signed certificate", "unable to verify the first certificate"]) {
      const impl: FetchImpl = async () => {
        throw new TypeError(message);
      };
      const err = await collect("https://bad.example/", impl).catch((e) => e);
      expect(err, message).toBeInstanceOf(AuditError);
      expect(err).toMatchObject({ code: "bad_certificate", messageKey: "certificate" });
    }
  });
  it("leaves other failures as unreachable and does not leak the original message", async () => {
    const impl: FetchImpl = async () => {
      throw new TypeError("connect ECONNREFUSED 10.0.0.1:443");
    };
    const err = await collect("https://down.example/", impl).catch((e) => e);
    expect(err).toMatchObject({ code: "unreachable", messageKey: "unreachable" });
    expect(String(err.message)).not.toContain("10.0.0.1");
  });
});

describe("budget and pool", () => {
  it("refuses requests after the budget is spent", async () => {
    const budget = new Budget(2);
    const impl: FetchImpl = async () => new Response("x");
    await fetchChecked("https://a.example/", impl, { budget });
    await fetchChecked("https://b.example/", impl, { budget });
    await expect(fetchChecked("https://c.example/", impl, { budget })).rejects.toMatchObject({ code: "budget" });
    expect(budget.used).toBe(2);
    expect([...budget.hosts]).toEqual(["a.example", "b.example"]);
  });
  it("counts every redirect hop and validates each of them", async () => {
    const budget = new Budget(10);
    const impl: FetchImpl = async (u) => (u === "https://a.example/" ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) : new Response("x"));
    await expect(fetchChecked("https://a.example/", impl, { budget })).rejects.toMatchObject({ code: "blocked_target" });
    expect(budget.used).toBe(1);
  });
  it("mapPool keeps order and limits concurrency", async () => {
    let now = 0;
    let max = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      now++;
      max = Math.max(max, now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(max).toBeLessThanOrEqual(3);
  });
});

afterEach(() => {
  // keep tests independent of any limit changed above
  expect(LIMITS.totalTimeoutMs).toBe(15_000);
});
