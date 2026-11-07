import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { PAGESPEED_ENDPOINT, runPagespeed } from "../src/pagespeed";

const lighthouse = {
  lighthouseResult: {
    fetchTime: "2026-11-07T10:00:00.000Z",
    categories: { performance: { score: 0.64 } },
    audits: {
      "largest-contentful-paint": { numericValue: 3100 },
      "cumulative-layout-shift": { numericValue: 0.2 },
      "total-blocking-time": { numericValue: 450 },
      "first-contentful-paint": { numericValue: 1700 },
    },
  },
};
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const env: Env = { PAGESPEED_API_KEY: "SECRET-KEY-123" };
const call = (path: string, init?: RequestInit, e: Env = env) => worker.fetch(new Request("https://audit.test" + path, init), e);
const post = (body: unknown, e: Env = env, query = "") =>
  call("/api/pagespeed" + query, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, e);

afterEach(() => vi.unstubAllGlobals());

describe("runPagespeed", () => {
  it("asks for the mobile performance run and returns the parsed values", async () => {
    let requested = "";
    const out = await runPagespeed("https://example.com/", "K", async (url) => {
      requested = url;
      return jsonResponse(lighthouse);
    });
    const u = new URL(requested);
    expect(u.origin + u.pathname).toBe(PAGESPEED_ENDPOINT);
    expect(Object.fromEntries(u.searchParams)).toEqual({ url: "https://example.com/", strategy: "mobile", category: "performance", key: "K" });
    expect(out).toMatchObject({ ok: true, result: { score: 64, lcpMs: 3100, cls: 0.2, tbtMs: 450, fcpMs: 1700, inpMs: null } });
  });
  it("maps failures to safe error keys", async () => {
    const run = (res: () => Response | Promise<Response>) => runPagespeed("https://example.com/", "K", async () => res());
    expect(await run(() => jsonResponse({ error: {} }, 429))).toEqual({ ok: false, status: 429, key: "pagespeed_quota" });
    expect(await run(() => jsonResponse({ error: {} }, 500))).toMatchObject({ ok: false, key: "pagespeed_failed" });
    expect(await run(() => jsonResponse({ error: {} }, 400))).toMatchObject({ ok: false, key: "pagespeed_failed" });
    expect(await run(() => jsonResponse({ error: {} }, 403))).toMatchObject({ ok: false, key: "pagespeed_unavailable" });
    expect(await run(() => new Response("<html>", { status: 200 }))).toMatchObject({ ok: false, key: "pagespeed_failed" });
    expect(await run(() => jsonResponse({}))).toMatchObject({ ok: false, key: "pagespeed_failed" });
    expect(await runPagespeed("https://example.com/", "K", async () => { throw new TypeError("network"); })).toMatchObject({ key: "pagespeed_unavailable" });
    expect(await runPagespeed("https://example.com/", "K", async () => { throw new DOMException("t", "TimeoutError"); })).toMatchObject({ status: 504, key: "pagespeed_timeout" });
  });
});

describe("/api/pagespeed", () => {
  it("does not exist without the key, and the audit says the feature is off", async () => {
    expect((await post({ url: "https://example.com" }, {})).status).toBe(404);
    vi.stubGlobal("fetch", async () => new Response("<html><head><title>x</title></head></html>", { headers: { "content-type": "text/html" } }));
    const report = (await (await call("/api/audit", { method: "POST", body: JSON.stringify({ url: "https://example.com" }) }, {})).json()) as any;
    expect(report.pagespeedAvailable).toBe(false);
    expect(report.neutral.pagespeedAvailable).toBe(false);
  });

  it("is announced by the audit when the key is set", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html><head><title>x</title></head></html>", { headers: { "content-type": "text/html" } }));
    const report = (await (await call("/api/audit", { method: "POST", body: JSON.stringify({ url: "https://example.com" }) })).json()) as any;
    expect(report.pagespeedAvailable).toBe(true);
  });

  it("returns the neutral measurement and never shows the key", async () => {
    let seen = "";
    vi.stubGlobal("fetch", async (url: string) => {
      seen = url;
      return jsonResponse(lighthouse);
    });
    const res = await post({ url: "example.com" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).pagespeed).toMatchObject({ strategy: "mobile", score: 64, lcpMs: 3100 });
    expect(text).not.toContain("SECRET-KEY-123");
    expect(seen).toContain("key=SECRET-KEY-123");
    expect(seen).toContain("url=https%3A%2F%2Fexample.com%2F");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("checks the address like the audit does and never calls Google for a private one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["http://127.0.0.1/", "http://localhost", "https://[::1]/", "ftp://example.com"]) {
      const res = await post({ url });
      expect(res.status, url).toBe(400);
    }
    expect((await post({ url: 5 })).status).toBe(400);
    expect((await call("/api/pagespeed", { method: "POST", body: "not json" })).status).toBe(400);
    expect((await call("/api/pagespeed", { method: "POST", body: "x".repeat(5000) })).status).toBe(413);
    expect((await call("/api/pagespeed")).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers errors gently, in the requested language, without details from Google", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ error: { message: "API key not valid SECRET-KEY-123" } }, 429));
    const res = await post({ url: "https://example.com" }, env, "?lang=en");
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toEqual({ code: "pagespeed_quota", key: "pagespeed_quota", message: "The PageSpeed measurement limit has been reached. Try again later." });
    vi.stubGlobal("fetch", async () => jsonResponse({}, 500));
    const pl = (await (await post({ url: "https://example.com" })).json()) as any;
    expect(pl.error.message).toBe("Google nie zdołał zmierzyć tej strony.");
  });

  it("is rate limited separately from audits", async () => {
    const keys: string[] = [];
    const limited: Env = { ...env, RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: false }) } };
    const res = await post({ url: "https://example.com" }, limited);
    expect(res.status).toBe(429);
    expect(keys[0]).toMatch(/^pagespeed:/);
  });
});
