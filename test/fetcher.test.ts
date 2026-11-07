import { describe, expect, it } from "vitest";
import { AuditError, buildInput, collect, fetchChecked, LIMITS, type FetchImpl } from "../src/fetcher";

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { location: to } });
}

describe("fetchChecked", () => {
  it("follows redirects manually and validates every hop", async () => {
    const calls: string[] = [];
    const impl: FetchImpl = async (u) => {
      calls.push(u);
      return redirect("http://127.0.0.1/admin");
    };
    await expect(fetchChecked("https://example.com/", impl)).rejects.toMatchObject({ code: "blocked_target" });
    expect(calls).toEqual(["https://example.com/"]); // the private target was never requested
  });

  it("blocks redirects to internal names, odd ports and relative tricks", async () => {
    for (const loc of ["http://localhost/", "https://example.com:8443/", "http://[::1]/", "ftp://example.com/", "http://metadata.internal/"]) {
      const impl: FetchImpl = async () => redirect(loc);
      await expect(fetchChecked("https://example.com/", impl), loc).rejects.toBeInstanceOf(AuditError);
    }
  });

  it("resolves relative redirects", async () => {
    const calls: string[] = [];
    const impl: FetchImpl = async (u) => {
      calls.push(u);
      return calls.length === 1 ? redirect("/final") : new Response("<html></html>", { status: 200 });
    };
    const r = await fetchChecked("https://example.com/start", impl);
    expect(calls).toEqual(["https://example.com/start", "https://example.com/final"]);
    expect(r.finalUrl).toBe("https://example.com/final");
    expect(r.redirectCount).toBe(1);
  });

  it("stops after too many redirects", async () => {
    const impl: FetchImpl = async () => redirect("https://example.com/again");
    await expect(fetchChecked("https://example.com/", impl)).rejects.toMatchObject({ code: "too_many_redirects" });
  });

  it("truncates bodies at the size limit", async () => {
    const big = "a".repeat(LIMITS.maxBytes + 5000);
    const r = await fetchChecked("https://example.com/", async () => new Response(big));
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(LIMITS.maxBytes);
  });

  it("maps network failures to AuditError", async () => {
    const impl: FetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchChecked("https://example.com/", impl)).rejects.toMatchObject({ code: "unreachable" });
    const timeout: FetchImpl = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await expect(fetchChecked("https://example.com/", timeout)).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("time limits", () => {
  it("stops reading a body that never finishes", async () => {
    const impl: FetchImpl = async (_u, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("<html>"));
          // never closes
        },
      });
      void init;
      return new Response(body, { status: 200 });
    };
    const original = AbortSignal.timeout;
    AbortSignal.timeout = () => original.call(AbortSignal, 50);
    try {
      await expect(fetchChecked("https://example.com/", impl)).rejects.toMatchObject({ code: "timeout" });
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it("applies one overall deadline across redirects", async () => {
    const impl: FetchImpl = async () => redirect("https://example.com/next");
    await expect(
      fetchChecked("https://example.com/", impl, { deadline: Date.now() - 1 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("blocks credentials and odd ports on redirect targets", async () => {
    for (const loc of ["http://user:pw@example.com/", "https://example.com:8443/", "https://[::1]/", "https://[::ffff:7f00:1]/"]) {
      const impl: FetchImpl = async () => redirect(loc);
      await expect(fetchChecked("https://example.com/", impl)).rejects.toMatchObject({ code: "blocked_target" });
    }
  });
});

describe("collect", () => {
  it("assembles the audit input from page, http test, robots and sitemap", async () => {
    const impl: FetchImpl = async (u) => {
      if (u === "http://example.com/") return redirect("https://example.com/", 301);
      if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nSitemap: https://example.com/sitemap.xml", { headers: { "content-type": "text/plain" } });
      if (u.endsWith("/sitemap.xml")) return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
      return new Response("<html lang=en><title>x</title></html>", { headers: { "content-type": "text/html" } });
    };
    const input = await collect("https://example.com/", impl);
    expect(input.httpRedirect).toEqual({ redirectsToHttps: true });
    expect(input.robotsTxt).toEqual({ found: true, hasSitemapLine: true, blocksAll: false });
    expect(input.sitemapXml.found).toBe(true);
    expect(input.status).toBe(200);
  });

  it("does not trust soft 404 pages served as HTML for robots.txt and sitemap.xml", async () => {
    const impl: FetchImpl = async () => new Response("<html>Not found</html>", { headers: { "content-type": "text/html" } });
    const input = await collect("https://example.com/", impl);
    expect(input.robotsTxt.found).toBe(false);
    expect(input.sitemapXml.found).toBe(false);
  });
});

describe("buildInput", () => {
  it("ignores a robots.txt that answered with an error", () => {
    const page = { finalUrl: "https://a.example/", setCookies: [], status: 200, headers: {}, body: "", bytes: 0, truncated: false, redirectCount: 0, ms: 5 };
    const robots = { ...page, status: 404, body: "nope" };
    expect(buildInput("https://a.example/", page, null, robots, null).robotsTxt.found).toBe(false);
  });
});
